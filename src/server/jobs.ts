// 서버의 분석 실행 관리 (브라우저 경로, P1-5-R1의 SubprocessDriver 쪽).
// - 입력 검증: 종목(P1-7-R1)·모드 열거형(R2)·idempotency key. 작업 ID·파일명은 서버가 만든다
// - P0-8-R4: 같은 키의 재요청은 새 작업을 만들지 않고 기존 작업을 돌려준다 (서버 재시작 뒤에도 작업 기록으로 찾는다)
// - P0-8-R5: maxConcurrentJobs를 넘는 요청은 대기열에 넣지 않고 실행 중 작업을 알려준다
// - P0-8-R6: 취소는 AbortSignal → 드라이버가 claude 프로세스 트리를 끝낸 뒤 CANCELLED로 확정한다
// - 진행 이벤트: 작업 기록이 저장될 때마다 작업 보기, 역할 호출 시작·끝 (SSE로 보낸다)
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { yahooUsLookup } from '../core/data/adapters.ts';
import { createBlockedNet, createRealNet, type NetClient } from '../core/data/net.ts';
import { normalizeSymbolInput } from '../core/data/registry.ts';
import type { AnalysisSnapshot } from '../core/data/snapshot.ts';
import { demoAcquirer, demoClock, demoDriver, demoPositions, DemoUnavailableError, loadDemo } from '../core/demo.ts';
import type { BookRead } from '../core/position/store.ts';
import { MAX_CONCURRENT_JOBS } from '../core/job/budget.ts';
import { createEngine, type Acquirer, type Engine, type Job } from '../core/job/engine.ts';
import type { JobRecord } from '../core/job/record.ts';
import { runJob } from '../core/job/runner.ts';
import { isTerminal, type JobState } from '../core/job/state.ts';
import { isJobId, JobStore } from '../core/job/store.ts';
import { realAcquirer, realClaudeCheck, realClaudeVersion, type ClaudeCheck } from '../core/live.ts';
import { createClaudeCliDriver } from '../core/model/claude-cli.ts';
import type { ModelDriver } from '../core/model/driver.ts';
import { ERROR_CODES, type ErrorCode } from '../core/model/errors.ts';
import { PositionService } from '../core/position/service.ts';
import { ReportStore, reportSaver } from '../core/report/store.ts';
import { MODES, type Mode, type Role } from '../core/schema/types.ts';
import { redact } from './security.ts';
import { DIAGNOSTICS_PATH, jobView, type JobView } from './view.ts';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;

export type JobEvent =
  | { type: 'job'; job: JobView }
  | { type: 'call'; phase: 'start'; role: Role }
  | { type: 'call'; phase: 'end'; role: Role; ok: boolean; code: ErrorCode | null; durationMs: number; outputChars: number | null }
  | { type: 'end'; state: JobState };

export type StartResult =
  | { kind: 'started'; jobId: string; existing: boolean }
  | { kind: 'busy'; runningJobId: string | null }
  | { kind: 'rejected'; status: 400 | 503; code: string; message: string; hint?: string };

export interface JobManagerOptions {
  /** jobs/와 reports/가 있는 디렉터리 */
  root: string;
  env: NodeJS.ProcessEnv;
  now?: () => Date;
  tzOffsetMinutes?: number;
  maxConcurrentJobs?: number;
  acquirer?: (symbol: string, mode: Mode) => Acquirer;
  driver?: (engine: Engine, job: Job) => ModelDriver;
  checkClaude?: () => Promise<ClaudeCheck>;
  claudeVersion?: () => Promise<string>;
  demoDir?: string;
  /** 데모 역할 사이 연출 지연 (ms) */
  demoDelayMs?: number;
  /** 데모 네트워크 (기본: 차단 구현). 테스트가 요청 수를 센다 */
  demoNet?: NetClient;
  log?: (line: string) => void;
  /** 보유 포지션 북 (기본: <root>/.floor/positions.json, 미국 종목은 실제 조회) */
  positions?: PositionService;
}

/** 저장할 때마다 알린다 (SSE) */
class ObservedJobStore extends JobStore {
  private readonly onChange: (rec: JobRecord) => void;

  constructor(root: string, onChange: (rec: JobRecord) => void) {
    super(root);
    this.onChange = onChange;
  }

  override create(rec: JobRecord): void {
    super.create(rec);
    this.onChange(rec);
  }

  override save(rec: JobRecord): void {
    super.save(rec);
    this.onChange(rec);
  }
}

const rejected = (status: 400 | 503, code: string, message: string, hint?: string): StartResult =>
  ({ kind: 'rejected', status, code, message, ...(hint ? { hint } : {}) });

export class JobManager {
  readonly jobs: JobStore;
  readonly reports: ReportStore;
  readonly positions: PositionService;
  private readonly o: JobManagerOptions;
  private readonly now: () => Date;
  private readonly max: number;
  private readonly home = homedir();
  private readonly active = new Map<string, { ac: AbortController; done: Promise<void> }>();
  private reserved = 0;
  private readonly inflight = new Map<string, Promise<StartResult>>();
  private readonly listeners = new Map<string, Set<(e: JobEvent) => void>>();
  private version: Promise<string> | null = null;
  /** idempotency key → jobId. 처음 한 번만 작업 기록을 훑고, 이후 이 서버가 만든 작업을 더한다 (요청마다 전체를 읽지 않게) */
  private keys: Map<string, string> | null = null;

  private keyIndex(): Map<string, string> {
    if (!this.keys) this.keys = new Map(this.jobs.list().map((r) => [r.idempotencyKey, r.jobId]));
    return this.keys;
  }

  constructor(o: JobManagerOptions) {
    this.o = o;
    this.now = o.now ?? (() => new Date());
    this.max = o.maxConcurrentJobs ?? MAX_CONCURRENT_JOBS;
    this.jobs = new ObservedJobStore(join(o.root, 'jobs'), (rec) => this.emit(rec.jobId, () => ({ type: 'job', job: jobView(rec, this.now(), this.home) })));
    this.reports = new ReportStore(join(o.root, 'reports'), o.tzOffsetMinutes === undefined ? {} : { tzOffsetMinutes: o.tzOffsetMinutes });
    this.positions = o.positions ?? new PositionService({ root: o.root, now: this.now, lookup: (t) => yahooUsLookup(createRealNet())(t) });
  }

  /**
   * 서버 시작 정리 (P1-1-R5, P1-6-R7): 이 경로의 진행 중 작업만 INTERRUPTED로 바꾸고(/floor 작업은 sweepAbandoned에 맡긴다),
   * Markdown이 없는 리포트를 다시 만들고, 1시간 지난 임시 파일을 지운다
   */
  recover(kill?: (pid: number) => void): { interrupted: string[]; repaired: string[]; cleaned: string[] } {
    const engine = createEngine({ store: this.jobs, now: this.now });
    const interrupted = engine.recoverInterrupted(kill, (id) => this.reports.get(id) !== null, (r) => r.executionBackend === 'subprocess_per_role');
    return { interrupted, repaired: this.reports.repair(), cleaned: this.reports.cleanupTmp(this.now()) };
  }

  running(): string[] {
    return [...this.active.keys()];
  }

  async start(req: { symbol?: unknown; mode?: unknown; idempotencyKey?: unknown; demo?: unknown; demoScenario?: unknown }): Promise<StartResult> {
    const sym = normalizeSymbolInput(req.symbol);
    if (!sym.ok) return rejected(400, 'E-INPUT', sym.message);
    const mode = MODES.find((m) => m === req.mode);
    if (!mode) return rejected(400, 'E-INPUT', `모드는 ${MODES.join(', ')} 중 하나여야 합니다`);
    const key = req.idempotencyKey;
    if (typeof key !== 'string' || !IDEMPOTENCY_KEY.test(key)) return rejected(400, 'E-INPUT', 'idempotencyKey가 필요합니다 (영문·숫자·-·_ 8~64자)');
    if (req.demo !== undefined && typeof req.demo !== 'boolean') return rejected(400, 'E-INPUT', 'demo는 true/false');
    const demo = req.demo === true;
    if (req.demoScenario !== undefined && (!demo || typeof req.demoScenario !== 'string' || !/^[a-z0-9-]{1,40}$/.test(req.demoScenario))) {
      return rejected(400, 'E-INPUT', 'demoScenario는 데모에서만 쓰는 시나리오 이름입니다');
    }
    const scenario = req.demoScenario as string | undefined;

    const pending = this.inflight.get(key);
    if (pending) return pending.then((r) => (r.kind === 'started' ? { ...r, existing: true } : r));
    const found = this.keyIndex().get(key);
    if (found) return { kind: 'started', jobId: found, existing: true };
    if (this.active.size + this.reserved >= this.max) return { kind: 'busy', runningJobId: this.running()[0] ?? null };

    this.reserved++;
    const p = this.launch(req.symbol as string, sym.normalized, mode, key, demo, scenario);
    this.inflight.set(key, p);
    const r = await p;
    if (r.kind !== 'started') this.inflight.delete(key);
    return r;
  }

  private async launch(symbolInput: string, normalized: string, mode: Mode, key: string, demo: boolean, scenario?: string): Promise<StartResult> {
    let released = false;
    const release = () => {
      if (!released) this.reserved--;
      released = true;
    };
    try {
      let acq: Acquirer;
      let clock = this.now;
      let driverFor: (engine: Engine, job: Job) => ModelDriver;
      let version: () => Promise<string>;
      let demoBook: (() => BookRead | null) | undefined;
      if (demo) {
        let s: ReturnType<typeof loadDemo>;
        try {
          s = loadDemo(mode, this.o.demoDir, scenario);
        } catch (e) {
          if (e instanceof DemoUnavailableError) return rejected(400, 'E-DEMO', e.message);
          throw e;
        }
        if (s.symbol.toUpperCase() !== normalized) return rejected(400, 'E-DEMO', `데모는 ${s.symbol} ${mode}만 있습니다`);
        clock = demoClock(s);
        acq = demoAcquirer(s, this.o.demoNet ?? createBlockedNet());
        driverFor = (_e, job) => demoDriver(s, job.snapshot!.snapshotId, this.o.demoDelayMs ?? 1200);
        demoBook = () => demoPositions(s);
        version = async () => 'none';
      } else {
        const c = await (this.o.checkClaude ?? (() => realClaudeCheck(this.o.env)))();
        if (!c.ok) return rejected(503, c.code, `${ERROR_CODES[c.code].message} (${c.detail})`, DIAGNOSTICS_PATH);
        acq = (this.o.acquirer ?? realAcquirer)(symbolInput, mode);
        driverFor = this.o.driver ?? ((engine, job) => createClaudeCliDriver({ env: this.o.env, onSpawn: (pid) => engine.trackPid(job, pid), onExit: (pid) => engine.untrackPid(job, pid) }));
        version = () => (this.version ??= (this.o.claudeVersion ?? (() => realClaudeVersion(this.o.env)))());
      }

      const engine = createEngine({ store: this.jobs, now: clock, positions: () => this.positions.read(), ...(demoBook ? { demoPositions: demoBook } : {}) });
      const jobId = randomUUID();
      const ac = new AbortController();
      // createJob은 첫 await 전에 작업 기록을 만든다: 여기서 돌려주는 jobId는 바로 조회할 수 있다
      const created = engine.createJob({ jobId, idempotencyKey: key, mode, symbolInput, interface: 'web', demo }, acq);
      this.keyIndex().set(key, jobId);
      const done = this.run(engine, created, ac, driverFor, version, clock).finally(() => {
        this.active.delete(jobId);
        this.emit(jobId, () => ({ type: 'end', state: this.record(jobId)?.state ?? 'FAILED' }));
      });
      this.active.set(jobId, { ac, done });
      return { kind: 'started', jobId, existing: false };
    } finally {
      release();
    }
  }

  private async run(engine: Engine, created: Promise<Job>, ac: AbortController, driverFor: (engine: Engine, job: Job) => ModelDriver, version: () => Promise<string>, clock: () => Date): Promise<void> {
    let job: Job | null = null;
    try {
      job = await created;
      if (isTerminal(job.record.state)) return;
      if (ac.signal.aborted) {
        engine.fail(job, 'E-CANCELLED', '데이터 수집 중 취소');
        return;
      }
      const jobId = job.record.jobId;
      const base = driverFor(engine, job);
      const driver: ModelDriver = {
        kind: base.kind, countsAsModelCall: base.countsAsModelCall,
        call: async (req, signal) => {
          this.emit(jobId, () => ({ type: 'call', phase: 'start', role: req.role }));
          const r = await base.call(req, signal);
          this.emit(jobId, () => ({ type: 'call', phase: 'end', role: req.role, ok: r.ok, code: r.ok ? null : r.code, durationMs: r.durationMs, outputChars: r.ok ? r.outputChars : null }));
          return r;
        },
      };
      const claudeCliVersion = await version();
      await runJob(engine, job, driver, ac.signal, { save: reportSaver(this.reports, { claudeCliVersion }, clock), claudeCliVersion });
    } catch (e) {
      this.o.log?.(redact(`작업 실행 오류: ${(e as Error).stack ?? String(e)}`, [], this.home));
      if (job && !isTerminal(job.record.state)) {
        try { engine.fail(job, 'E-INTERRUPTED', '서버 내부 오류로 중단'); } catch { /* 이미 종료 */ }
      }
    }
  }

  /** 실행 중이면 취소 신호를 보낸다. 상태는 프로세스 종료 확인 뒤 runJob이 확정한다 */
  cancel(jobId: string): boolean {
    const a = this.active.get(jobId);
    if (!a || a.ac.signal.aborted) return false;
    a.ac.abort();
    return true;
  }

  cancelAll(): void {
    for (const id of this.active.keys()) this.cancel(id);
  }

  async idle(): Promise<void> {
    while (this.active.size > 0) await Promise.all([...this.active.values()].map((a) => a.done));
  }

  private record(jobId: string): JobRecord | null {
    if (!isJobId(jobId) || !existsSync(join(this.jobs.dir(jobId), 'job.json'))) return null;
    try {
      return this.jobs.load(jobId);
    } catch {
      return null;
    }
  }

  view(jobId: string): JobView | null {
    const r = this.record(jobId);
    return r ? jobView(r, this.now(), this.home) : null;
  }

  snapshot(jobId: string): AnalysisSnapshot | null {
    const r = this.record(jobId);
    if (!r?.snapshot) return null;
    try {
      return this.jobs.readJson<AnalysisSnapshot>(jobId, 'snapshot.json');
    } catch {
      return null;
    }
  }

  subscribe(jobId: string, fn: (e: JobEvent) => void): () => void {
    let set = this.listeners.get(jobId);
    if (!set) this.listeners.set(jobId, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.listeners.delete(jobId);
    };
  }

  private emit(jobId: string, make: () => JobEvent): void {
    const set = this.listeners.get(jobId);
    if (!set || set.size === 0) return;
    const e = make();
    for (const fn of [...set]) {
      try { fn(e); } catch { /* 끊긴 연결 */ }
    }
  }
}
