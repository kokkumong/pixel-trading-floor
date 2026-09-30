// 단계 엔진 (P1-5-R1): createJob → next → submit → finalize.
// 브라우저 경로(runner.ts가 드라이버로 역할을 호출), /floor(세션이 CLI로 next·submit·finalize), 데모(FixtureDriver)가 모두 이 함수들을 쓴다.
// 두 경로의 차이는 "역할 출력을 누가 만드는가"뿐이다. 모든 상태 변경은 작업 기록에 원자적으로 저장한다 (P1-1-R1).
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { judgeClock } from '../data/clock.ts';
import { buildRoleInput, fitInput, InputBudgetError, type PriorOutputs, type RoleInput } from '../data/project.ts';
import type { Instrument, Resolution } from '../data/registry.ts';
import { assembleSnapshot, hashSnapshot, type AnalysisSnapshot } from '../data/snapshot.ts';
import type { SourceRecord } from '../data/sources.ts';
import type { ModelRequest } from '../model/driver.ts';
import { ERROR_CODES, type ErrorCode } from '../model/errors.ts';
import { jsonSchemaFor, prompts as defaultPrompts, type PromptSet } from '../prompts/index.ts';
import type { SchemaError } from '../schema/dsl.ts';
import type { FinalDecision } from '../schema/decision.ts';
import { buildPositionContext } from '../position/context.ts';
import type { BookRead } from '../position/store.ts';
import type { MarketType, Role } from '../schema/types.ts';
import { budgetFor, modelFor, type JobBudget } from './budget.ts';
import { auditJob, buildDecision, insufficientDecision } from './decide.ts';
import { newJobRecord, type JobRecord, type JobRequest } from './record.ts';
import type { Validation } from './retry.ts';
import { isTerminal, transition, type JobState, type TerminalState } from './state.ts';
import { checkStepOutput, pendingSteps, summarizeErrors, type StepKey } from './steps.ts';
import type { JobStore } from './store.ts';

/** 종목 해석과 소스 수집 (네트워크는 여기서만). 테스트는 녹화된 응답으로 만든다 */
export interface Acquirer {
  registryVersion: string;
  resolve(): Promise<Resolution>;
  collect(instrument: Instrument, marketType: MarketType): Promise<SourceRecord[]>;
  /** 수집 중 잰 PC 시계 오차 (ms). 60초를 넘으면 스냅샷을 만들기 전에 E-CLOCK으로 막는다 (P1-8.2, E13) */
  clockSkewMs?(): number | null;
}

export interface Job {
  record: JobRecord;
  snapshot: AnalysisSnapshot | null;
}

export interface Step extends StepKey {
  input: RoleInput;
  inputText: string;
  /** jobs/<jobId>/inputs/<stepId>.json — /floor 세션이 읽는 입력 파일이자 독립성 검증 기준 (P1-10-R4) */
  inputPath: string;
  request: Pick<ModelRequest, 'role' | 'systemPrompt' | 'jsonSchema' | 'model' | 'effort'>;
}

export type NextResult = { kind: 'steps'; steps: Step[] } | { kind: 'finalize' } | { kind: 'done'; state: JobState };

export type SubmitResult =
  | { ok: true }
  | { ok: false; kind: 'rejected'; message: string }
  | { ok: false; kind: 'schema'; errors: SchemaError[]; summary: string; terminal: boolean };

export class EngineError extends Error {}

export interface EngineOptions {
  store: JobStore;
  now?: () => Date;
  prompts?: PromptSet;
  /** 보유 포지션 북 읽기 (P2-1-R8). 작업 시작 때 한 번 읽는다. 없으면 포지션 컨텍스트를 만들지 않는다 */
  positions?: () => BookRead;
}

export interface FinalizeOptions {
  /** SAVING 단계에서 리포트를 저장한다 (Phase 5). 실패하면 E-DISK */
  save?: (job: Job) => void;
  /** 작업 기록에 남길 Claude CLI 버전 (P1-11-R3). 이미 기록돼 있으면 덮어쓰지 않는다 */
  claudeCliVersion?: string;
}

export type NewJobRequest = Omit<JobRequest, 'jobId'> & { jobId?: string };

export interface Engine {
  now(): Date;
  createJob(req: NewJobRequest, acq: Acquirer): Promise<Job>;
  openJob(jobId: string): Job;
  next(job: Job): NextResult;
  validate(job: Job, stepId: string, raw: unknown): Validation<unknown>;
  submit(job: Job, stepId: string, raw: unknown): SubmitResult;
  syncUsage(job: Job, budget: JobBudget): void;
  fail(job: Job, code: ErrorCode, detail: string, role?: Role | null): void;
  finalize(job: Job, opts?: FinalizeOptions): FinalDecision | null;
  trackPid(job: Job, pid: number): void;
  untrackPid(job: Job, pid: number): void;
  /**
   * 서버 시작 시: 진행 중 작업을 INTERRUPTED로 바꾸고 기록된 하위 프로세스를 종료한다 (P1-1-R5).
   * SAVING에서 멈췄는데 리포트 JSON이 온전히 저장돼 있으면(hasReport) COMPLETED로 확정한다 (P1-6-T2).
   * only로 대상을 고른다: 서버는 자기 경로의 작업(subprocess_per_role)만 정리하고 /floor 작업은 sweepAbandoned에 맡긴다
   */
  recoverInterrupted(kill?: (pid: number) => void, hasReport?: (jobId: string) => boolean, only?: (r: JobRecord) => boolean): string[];
  /**
   * P1-5-T3: finalize 없이 세션이 끝난 /floor 작업 정리. 코어 명령마다 부른다.
   * 스냅샷 뒤 maxDurationSeconds가 지난 진행 중 single_session 작업을 INTERRUPTED로 바꾼다 (지금 명령의 작업은 제외)
   */
  sweepAbandoned(exceptJobId?: string): string[];
}

export function createEngine(opts: EngineOptions): Engine {
  const { store } = opts;
  const now = opts.now ?? (() => new Date());
  const prompts = opts.prompts ?? defaultPrompts;

  const save = (job: Job) => store.save(job.record);
  const move = (job: Job, to: JobState) => transition(job.record, to, now());

  function terminate(job: Job, to: TerminalState, code: ErrorCode, detail: string, role: Role | null = null): void {
    const r = job.record;
    r.error = { code, message: ERROR_CODES[code].message, detail, role };
    if (to !== 'COMPLETED' && to !== 'INSUFFICIENT_DATA') r.finalDecision = null; // P1-1-R4
    move(job, to);
    save(job);
  }

  function snapshotOf(job: Job): AnalysisSnapshot {
    if (!job.snapshot) throw new EngineError('스냅샷이 없는 작업');
    return job.snapshot;
  }

  function priorFor(r: JobRecord, step: StepKey): PriorOutputs {
    const o = r.outputs;
    return {
      briefings: o.briefings,
      debate: o.debate,
      reviews: o.reviews,
      ...(o.blitzPlan ? { blitzPlan: o.blitzPlan } : {}),
      ...(o.proposal ? { proposal: o.proposal } : {}),
      ...(step.round !== null ? { debateRound: step.round } : {}),
    };
  }

  function findPending(r: JobRecord, stepId: string): StepKey | string {
    if (isTerminal(r.state)) return `종료된 작업 (${r.state})`;
    const pending = pendingSteps(r);
    const k = pending.find((s) => s.stepId === stepId);
    if (!k) return `지금 제출할 수 있는 단계가 아님: ${stepId} (대기 중: ${pending.map((s) => s.stepId).join(', ') || '없음'})`;
    if (k.state !== r.state) return `next로 ${k.state} 단계를 먼저 시작해야 함`;
    return k;
  }

  return {
    now,

    async createJob(req, acq) {
      const record = newJobRecord({ ...req, jobId: req.jobId ?? randomUUID() }, now());
      store.create(record);
      const job: Job = { record, snapshot: null };
      // 시작 순간의 북으로 고정한다. 강제 방향은 포지션을 무시하고(D23) 데모는 실제 북을 읽지 않는다 (P2-8)
      const book = opts.positions && record.mode !== 'forced_direction' && !record.demo ? opts.positions() : null;

      let res: Resolution;
      try {
        res = await acq.resolve();
      } catch (e) {
        // 미국 종목 조회 요청 실패: 지원 여부를 모르므로 UNSUPPORTED_SYMBOL로 단정하지 않는다
        terminate(job, 'FAILED', 'E-DATA-REQUIRED', `종목 조회 실패: ${(e as Error).message}`);
        return job;
      }
      if (!res.ok) {
        terminate(job, 'UNSUPPORTED_SYMBOL', 'E-UNSUPPORTED-SYMBOL', res.message);
        return job;
      }
      record.instrumentId = res.instrument.instrumentId;
      record.marketType = res.marketType;
      move(job, 'COLLECTING_DATA');
      save(job);

      let records: SourceRecord[] = [];
      try {
        records = await acq.collect(res.instrument, res.marketType);
      } catch (e) {
        record.warnings.push(`수집 실패: ${(e as Error).message}`); // 모든 소스 실패로 취급 → 품질 판정에서 INSUFFICIENT_DATA
      }
      const skew = acq.clockSkewMs?.() ?? null;
      if (skew !== null) {
        const c = judgeClock(skew);
        if (c.level === 'error') {
          terminate(job, 'FAILED', 'E-CLOCK', c.message);
          return job;
        }
        if (c.level === 'warn') record.warnings.push(`시계 오차: ${c.message}`);
      }
      move(job, 'VALIDATING_DATA');
      const snap = assembleSnapshot({
        jobId: record.jobId, mode: record.mode, symbolInput: record.symbolInput, instrument: res.instrument, marketType: res.marketType,
        registryVersion: acq.registryVersion, requestedAt: new Date(record.createdAt), collectedAt: now(), records,
      });
      const path = store.writeJson(record.jobId, 'snapshot.json', snap);
      record.snapshot = { path, snapshotId: snap.snapshotId, snapshotHash: snap.snapshotHash, collectedAt: snap.collectedAt };
      job.snapshot = snap;
      if (book) record.positionContext = buildPositionContext(book, snap, now());

      // P0-4-R4: 필수 데이터 부족은 모델 호출 전에 끝낸다
      if (snap.dataQuality.status === 'INSUFFICIENT_DATA') {
        record.finalDecision = insufficientDecision(record, snap, now());
        const missing = snap.dataQuality.warnings.filter((w) => w.startsWith('필수 소스'));
        terminate(job, 'INSUFFICIENT_DATA', 'E-DATA-REQUIRED', missing.join('; ') || '필수 데이터 부족');
        return job;
      }
      save(job);
      return job;
    },

    openJob(jobId) {
      const record = store.load(jobId);
      if (!record.snapshot) return { record, snapshot: null };
      const snapshot = store.readJson<AnalysisSnapshot>(jobId, 'snapshot.json');
      if (hashSnapshot(snapshot) !== record.snapshot.snapshotHash || snapshot.snapshotHash !== record.snapshot.snapshotHash) {
        throw new EngineError(`스냅샷 해시 불일치: ${jobId} (스냅샷 파일이 바뀜)`);
      }
      return { record, snapshot };
    },

    next(job) {
      const r = job.record;
      if (isTerminal(r.state)) return { kind: 'done', state: r.state };
      const pending = pendingSteps(r);
      if (pending.length === 0) return { kind: 'finalize' };
      const snap = snapshotOf(job);
      const target = pending[0]!.state;
      if (r.state !== target) move(job, target);

      const cfg = budgetFor(r.mode);
      const steps: Step[] = [];
      for (const k of pending) {
        const systemPrompt = prompts.systemPrompt(k.role, r.mode);
        let fitted: ReturnType<typeof fitInput>;
        try {
          fitted = fitInput(buildRoleInput(snap, k.role, priorFor(r, k)), cfg.maxInputChars, systemPrompt.length);
        } catch (e) {
          if (!(e instanceof InputBudgetError)) throw e;
          terminate(job, 'BUDGET_EXCEEDED', 'E-BUDGET', e.message, k.role); // P0-8-R3
          return { kind: 'done', state: r.state };
        }
        for (const red of fitted.reductions) {
          const w = `${k.stepId} 입력 축소: ${red}`;
          if (!r.warnings.includes(w)) r.warnings.push(w);
        }
        const inputPath = store.writeJson(r.jobId, `inputs/${k.stepId}.json`, fitted.input);
        r.promptHashes[k.role] = prompts.hash(k.role, r.mode);
        const { model, effort } = modelFor(k.role);
        steps.push({
          ...k, input: fitted.input, inputText: fitted.text, inputPath,
          request: { role: k.role, systemPrompt, jsonSchema: jsonSchemaFor(k.role, r.mode), model, effort },
        });
      }
      save(job);
      return { kind: 'steps', steps };
    },

    validate(job, stepId, raw) {
      const k = findPending(job.record, stepId);
      if (typeof k === 'string') return { ok: false, summary: k };
      const c = checkStepOutput(job.record, k, raw);
      return c.ok ? { ok: true, value: raw } : { ok: false, summary: summarizeErrors(c.errors) };
    },

    submit(job, stepId, raw) {
      const r = job.record;
      const k = findPending(r, stepId);
      if (typeof k === 'string') return { ok: false, kind: 'rejected', message: k };

      // /floor: 제출 한 번이 역할 발언 한 번. 실패 뒤 다시 낸 제출은 재시도로 센다 (P1-5-R2)
      const single = r.executionBackend === 'single_session';
      if (single) {
        r.usage.roleTurnCount = (r.usage.roleTurnCount ?? 0) + 1;
        if ((r.submitRetries[stepId] ?? 0) > 0) r.usage.retryCallCount++;
      }
      const c = checkStepOutput(r, k, raw);
      if (!c.ok) {
        const summary = summarizeErrors(c.errors);
        let terminal = false;
        if (single) {
          const failures = (r.submitRetries[stepId] ?? 0) + 1;
          r.submitRetries[stepId] = failures;
          const cfg = budgetFor(r.mode);
          if (failures > cfg.maxRetriesPerCall || r.usage.retryCallCount >= cfg.maxRetriesPerJob) {
            terminate(job, 'SCHEMA_ERROR', 'E-SCHEMA', `${k.role}: ${summary}`, k.role);
            terminal = true;
          } else {
            save(job);
          }
        }
        return { ok: false, kind: 'schema', errors: c.errors, summary, terminal };
      }
      c.apply(r);
      r.evidenceAudit = auditJob(r, snapshotOf(job));
      save(job);
      return { ok: true };
    },

    syncUsage(job, budget) {
      const u = job.record.usage;
      u.modelCallCount = budget.modelCallCount;
      u.retryCallCount = budget.retryCallCount;
      u.calls = [...budget.calls];
      if (!isTerminal(job.record.state)) save(job);
    },

    fail(job, code, detail, role = null) {
      if (isTerminal(job.record.state)) return;
      terminate(job, ERROR_CODES[code].status, code, detail, role);
    },

    finalize(job, fopts = {}) {
      const r = job.record;
      if (isTerminal(r.state)) return r.finalDecision;
      const pending = pendingSteps(r);
      if (pending.length > 0) throw new EngineError(`남은 단계가 있음: ${pending.map((s) => s.stepId).join(', ')}`);
      const snap = snapshotOf(job);
      if (fopts.claudeCliVersion) r.claudeCliVersion ??= fopts.claudeCliVersion;

      // P0-F-R5: /floor는 세션 안의 사용량을 강제할 수 없으므로 끝에서 출력 수와 경과 시간을 검사한다
      if (r.executionBackend === 'single_session') {
        const cfg = budgetFor(r.mode);
        const o = r.outputs;
        const outputs = Object.keys(o.briefings).length + o.debate.length + o.reviews.length + [o.blitzPlan, o.proposal, o.pm].filter(Boolean).length;
        const elapsed = now().getTime() - Date.parse(snap.collectedAt);
        const over = outputs > r.plannedModelCallRange.max ? `역할 출력 ${outputs}개 > 계획 ${r.plannedModelCallRange.max}개`
          : (r.usage.roleTurnCount ?? 0) > cfg.maxModelCalls ? `역할 발언 ${r.usage.roleTurnCount}회 > 상한 ${cfg.maxModelCalls}회`
            : elapsed > cfg.maxDurationSeconds * 1000 ? `스냅샷 뒤 ${Math.round(elapsed / 1000)}초 경과 (상한 ${cfg.maxDurationSeconds}초)` : null;
        if (over) {
          terminate(job, 'BUDGET_EXCEEDED', 'E-BUDGET', over);
          return null;
        }
      }

      move(job, 'VALIDATING_DECISION');
      const decision = buildDecision(r, snap, now());
      r.finalDecision = decision;
      move(job, 'SAVING');
      save(job);
      try {
        fopts.save?.(job);
      } catch (e) {
        terminate(job, 'FAILED', 'E-DISK', (e as Error).message);
        return null;
      }
      move(job, 'COMPLETED');
      save(job);
      return decision;
    },

    trackPid(job, pid) {
      if (isTerminal(job.record.state) || job.record.pids.includes(pid)) return;
      job.record.pids.push(pid);
      save(job);
    },

    untrackPid(job, pid) {
      if (isTerminal(job.record.state)) return;
      job.record.pids = job.record.pids.filter((p) => p !== pid);
      save(job);
    },

    recoverInterrupted(kill = killRecordedProcess, hasReport = () => false, only = () => true) {
      const ids: string[] = [];
      for (const record of store.list()) {
        if (isTerminal(record.state) || !only(record)) continue;
        if (record.state === 'SAVING' && record.finalDecision && hasReport(record.jobId)) {
          record.pids = [];
          move({ record, snapshot: null }, 'COMPLETED');
          store.save(record);
          continue;
        }
        for (const pid of record.pids) {
          try { kill(pid); } catch { /* 이미 종료 */ }
        }
        record.pids = [];
        terminate({ record, snapshot: null }, 'INTERRUPTED', 'E-INTERRUPTED', `${record.state} 단계에서 서버 종료`);
        ids.push(record.jobId);
      }
      return ids;
    },

    sweepAbandoned(exceptJobId) {
      const ids: string[] = [];
      for (const record of store.list()) {
        if (isTerminal(record.state) || record.executionBackend !== 'single_session' || record.jobId === exceptJobId) continue;
        const since = Date.parse(record.snapshot?.collectedAt ?? record.createdAt);
        const limit = budgetFor(record.mode).maxDurationSeconds * 1000;
        if (now().getTime() - since <= limit) continue;
        terminate({ record, snapshot: null }, 'INTERRUPTED', 'E-INTERRUPTED', `${record.state} 단계에서 세션이 끝나 finalize되지 않음`);
        ids.push(record.jobId);
      }
      return ids;
    },
  };
}

/**
 * 재시작 시 남은 하위 프로세스 종료. PID가 재사용됐을 수 있으므로 POSIX에서는 명령줄에 claude가 있을 때만 그룹째 종료한다.
 * Windows는 taskkill /T /F (미검증).
 */
export function killRecordedProcess(pid: number): void {
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 이미 종료 */ }
    return;
  }
  let cmd = '';
  try {
    cmd = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
  } catch {
    return; // 프로세스 없음
  }
  if (!/claude/i.test(cmd)) return;
  try { process.kill(-pid, 'SIGKILL'); } catch { /* 그룹 없음 */ }
  try { process.kill(pid, 'SIGKILL'); } catch { /* 이미 종료 */ }
}
