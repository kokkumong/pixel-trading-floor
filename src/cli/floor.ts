// 공통 코어 CLI (P1 명세 5.1). 브라우저 경로와 /floor가 같은 엔진 함수를 쓴다 (P1-5-R1).
//   node src/cli/floor.ts analyze <종목> <모드> [--demo [--scenario <포지션 데모>]] [--json]      드라이버로 끝까지 실행 (실전: claude -p, 데모: fixture)
//   node src/cli/floor.ts snapshot --symbol <종목> --mode <모드>        /floor 1단계: 스냅샷과 작업 생성
//   node src/cli/floor.ts next --job <jobId>                             다음 역할과 입력·프롬프트·스키마 파일
//   node src/cli/floor.ts submit --job <jobId> --role <단계> --file <출력 JSON>
//   node src/cli/floor.ts finalize --job <jobId>                         규칙 엔진, 리포트 저장
//   node src/cli/floor.ts doctor [--json] [--claude-test]                통합 진단 (P1-8.2)
// snapshot·next·submit·finalize는 표준 출력에 JSON 한 개를 쓴다. 인자는 검증한 뒤에만 쓰고 셸 문자열에 잇지 않는다 (P0-F-R4).
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createRealNet, type NetClient } from '../core/data/net.ts';
import { demoAcquirer, demoClock, demoDriver, demoPositions, DemoUnavailableError, loadDemo, type DemoScenario } from '../core/demo.ts';
import { runDiagnostics, type Check } from '../core/diag.ts';
import { EngineError, createEngine, type Acquirer, type Engine, type Job } from '../core/job/engine.ts';
import { runJob } from '../core/job/runner.ts';
import { isTerminal, type JobState } from '../core/job/state.ts';
import { ANALYSTS, pendingSteps } from '../core/job/steps.ts';
import { isJobId, JobStore } from '../core/job/store.ts';
import { createClaudeCliDriver, type ClaudeExecutable } from '../core/model/claude-cli.ts';
import { needsDiagnostics, realAcquirer, realClaudeCheck, realClaudeVersion, type ClaudeCheck } from '../core/live.ts';
import type { ModelDriver } from '../core/model/driver.ts';
import { ERROR_CODES } from '../core/model/errors.ts';
import { PositionService } from '../core/position/service.ts';
import { ReportStore, reportSaver } from '../core/report/store.ts';
import { actionBiasLabel, CONFIDENCE_NOTE, panelView } from '../core/rules/display.ts';
import { MODES, type Mode } from '../core/schema/types.ts';
import { DEFAULT_PORT, parsePort } from '../server/options.ts';

/** 종료 코드 (P1-5.1 표). analyze는 같은 번호를 쓴다 */
export const EXIT = { OK: 0, OTHER: 1, UNSUPPORTED_SYMBOL: 2, INSUFFICIENT_DATA: 3, SCHEMA_ERROR: 4, BUDGET_EXCEEDED: 5, NO_MORE_STEPS: 10 } as const;

const MODE_ALIASES: Record<string, Mode> = {
  algorithm: 'algorithm', algo: 'algorithm', 알고리즘: 'algorithm',
  scalp: 'scalp', 스캘핑: 'scalp',
  forced_direction: 'forced_direction', forced: 'forced_direction', 공격: 'forced_direction', 강제: 'forced_direction',
};

export function parseMode(raw: string | undefined): Mode | null {
  if (!raw) return null;
  return MODE_ALIASES[raw.trim().toLowerCase()] ?? null;
}

export interface CliDeps {
  /** jobs/와 reports/가 있는 디렉터리 */
  root: string;
  out: (s: string) => void;
  err: (s: string) => void;
  env: NodeJS.ProcessEnv;
  now?: () => Date;
  /** 실전 데이터 획득기 (기본: 네트워크 + 시계 오차 측정) */
  acquirer?: (symbol: string, mode: Mode) => Acquirer;
  /** 실전 역할 드라이버 (기본: claude -p) */
  driver?: (engine: Engine, job: Job) => ModelDriver;
  /** 실전 분석 전 Claude 확인 (기본: 실행 파일과 auth status) */
  checkClaude?: () => Promise<ClaudeCheck>;
  claudeVersion?: () => Promise<string>;
  /** doctor용 */
  net?: NetClient;
  executable?: ClaudeExecutable | null;
  tzOffsetMinutes?: number;
  demoDir?: string;
  demoDelayMs?: number;
  signal?: AbortSignal;
}

export const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));

const DIAG_HINT = '진단: node src/cli/floor.ts doctor';

function exitForState(state: JobState): number {
  switch (state) {
    case 'COMPLETED': return EXIT.OK;
    case 'UNSUPPORTED_SYMBOL': return EXIT.UNSUPPORTED_SYMBOL;
    case 'INSUFFICIENT_DATA': return EXIT.INSUFFICIENT_DATA;
    case 'SCHEMA_ERROR': return EXIT.SCHEMA_ERROR;
    case 'BUDGET_EXCEEDED': return EXIT.BUDGET_EXCEEDED;
    default: return EXIT.OTHER;
  }
}

/** 역할 실행 순서 (코어가 정한다, E7). optional은 토론 조기 종료 시 건너뛰는 단계 */
export function plannedSteps(mode: Mode): { stepId: string; optional: boolean }[] {
  const a = ANALYSTS[mode].map((r) => ({ stepId: r, optional: false }));
  if (mode === 'algorithm') {
    return [
      ...a, { stepId: 'BULL-1', optional: false }, { stepId: 'BEAR-1', optional: false }, { stepId: 'BULL-2', optional: true }, { stepId: 'BEAR-2', optional: true },
      ...['ACE', 'RISKY', 'SAFE', 'NEUTRAL', 'PM'].map((s) => ({ stepId: s, optional: false })),
    ];
  }
  return [...a, ...['BLITZ', 'GUARD', 'ACE'].map((s) => ({ stepId: s, optional: false }))];
}

function errorJson(job: Job) {
  const e = job.record.error;
  if (!e) return null;
  return { ...e, ...(needsDiagnostics(e.code) ? { hint: DIAG_HINT } : {}) }; // P1-8-R6
}

function decisionJson(job: Job) {
  const d = job.record.finalDecision;
  if (!d) return null;
  return {
    status: d.status, action: d.action, bias: d.bias, confidenceBand: d.confidence?.band ?? null, finalDecisionMaker: d.finalDecisionMaker,
    pmDecision: d.pmDecision, verdict: d.ruleEngine.verdict, violations: d.ruleEngine.violations.map((v) => v.code), reasonCodes: d.reasonCodes,
  };
}

export async function main(argv: string[], deps: CliDeps): Promise<number> {
  const [cmd, ...rest] = argv;
  const json = (v: unknown) => deps.out(JSON.stringify(v, null, 2));
  const fail = (msg: string, code: number = EXIT.OTHER) => {
    deps.err(msg);
    return code;
  };
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs({
      args: rest, allowPositionals: true, strict: true,
      options: {
        symbol: { type: 'string' }, mode: { type: 'string' }, job: { type: 'string' }, role: { type: 'string' }, file: { type: 'string' },
        interface: { type: 'string' }, demo: { type: 'boolean' }, scenario: { type: 'string' }, json: { type: 'boolean' }, 'claude-test': { type: 'boolean' },
      },
    });
  } catch (e) {
    return fail(`${(e as Error).message}\n${USAGE}`);
  }
  const v = args.values as Record<string, string | boolean | undefined>;
  const str = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : undefined);
  const now = deps.now ?? (() => new Date());
  const jobs = new JobStore(join(deps.root, 'jobs'));
  const reports = new ReportStore(join(deps.root, 'reports'), deps.tzOffsetMinutes === undefined ? {} : { tzOffsetMinutes: deps.tzOffsetMinutes });
  // 보유 포지션은 작업 시작 때 한 번 읽어 고정한다 (P2-1-R8). 모델 입력 투영은 Phase 13
  const positions = new PositionService({ root: deps.root, now });

  const symbolMode = (): { symbol: string; mode: Mode } | string => {
    const symbol = str('symbol') ?? args.positionals[0];
    const modeRaw = str('mode') ?? args.positionals[1];
    if (!symbol) return '종목이 필요합니다 (--symbol)';
    const mode = parseMode(modeRaw);
    if (!mode) return `모드가 잘못되었습니다: ${String(modeRaw ?? '(없음)').slice(0, 40)} (가능: ${MODES.join(', ')})`;
    return { symbol, mode };
  };

  const openExisting = (engine: Engine): Job | string => {
    const id = str('job');
    if (!isJobId(id)) return `--job <jobId>가 필요합니다`;
    if (!existsSync(join(jobs.root, id, 'job.json'))) return `작업 없음: ${id}`;
    engine.sweepAbandoned(id); // P1-5-T3
    try {
      return engine.openJob(id);
    } catch (e) {
      return (e as Error).message;
    }
  };

  switch (cmd) {
    case 'snapshot': {
      const sm = symbolMode();
      if (typeof sm === 'string') return fail(sm);
      const iface = str('interface') ?? 'floor';
      if (iface !== 'floor' && iface !== 'web') return fail(`--interface는 floor 또는 web`);
      const engine = createEngine({ store: jobs, now, positions: () => positions.read() });
      engine.sweepAbandoned();
      const acq = (deps.acquirer ?? realAcquirer)(sm.symbol, sm.mode);
      const job = await engine.createJob({ idempotencyKey: `cli-${randomUUID()}`, mode: sm.mode, symbolInput: sm.symbol, interface: iface }, acq);
      const r = job.record;
      json({
        jobId: r.jobId, state: r.state, mode: r.mode, instrumentId: r.instrumentId, interface: r.interface, executionBackend: r.executionBackend,
        snapshotPath: r.snapshot?.path ?? null, snapshotHash: r.snapshot?.snapshotHash ?? null,
        dataQuality: job.snapshot ? { status: job.snapshot.dataQuality.status, warnings: job.snapshot.dataQuality.warnings } : null,
        plan: isTerminal(r.state) ? [] : plannedSteps(r.mode), error: errorJson(job),
      });
      return isTerminal(r.state) ? exitForState(r.state) : EXIT.OK;
    }

    case 'next': {
      const engine = createEngine({ store: jobs, now });
      const job = openExisting(engine);
      if (typeof job === 'string') return fail(job);
      const n = engine.next(job);
      if (n.kind === 'done') {
        json({ kind: 'done', jobId: job.record.jobId, state: n.state, error: errorJson(job) });
        return EXIT.NO_MORE_STEPS;
      }
      if (n.kind === 'finalize') {
        json({ kind: 'finalize', jobId: job.record.jobId, state: job.record.state });
        return EXIT.NO_MORE_STEPS;
      }
      const id = job.record.jobId;
      // 세션이 읽을 파일: 입력(엔진이 씀), 역할 프롬프트, 출력 스키마. 출력은 outputs/<단계>.json에 쓴다
      const steps = n.steps.map((s) => ({
        stepId: s.stepId, role: s.role, round: s.round, inputPath: s.inputPath,
        promptPath: jobs.writeText(id, `prompts/${s.stepId}.md`, s.request.systemPrompt),
        schemaPath: jobs.writeJson(id, `schemas/${s.stepId}.json`, s.request.jsonSchema),
        outputPath: jobs.path(id, `outputs/${s.stepId}.json`),
      }));
      mkdirSync(jobs.path(id, 'outputs'), { recursive: true });
      json({ kind: 'steps', jobId: id, state: job.record.state, steps });
      return EXIT.OK;
    }

    case 'submit': {
      const engine = createEngine({ store: jobs, now });
      const job = openExisting(engine);
      if (typeof job === 'string') return fail(job);
      const id = job.record.jobId;
      const file = str('file');
      const roleArg = str('role');
      if (!file || !roleArg) return fail('--role <단계>와 --file <출력 JSON>이 필요합니다');
      // P1-5-R3: 세션은 작업 디렉터리 안의 파일만 쓴다
      const abs = isAbsolute(file) ? file : resolve(file);
      let path: string;
      try {
        path = jobs.path(id, relative(jobs.dir(id), abs));
      } catch (e) {
        return fail(`작업 디렉터리 밖의 파일은 제출할 수 없음: ${(e as Error).message}`);
      }
      if (!existsSync(path)) return fail(`파일 없음: ${path}`);
      const pending = pendingSteps(job.record);
      const byRole = pending.filter((s) => s.role === roleArg);
      const stepId = pending.some((s) => s.stepId === roleArg) ? roleArg : byRole.length === 1 ? byRole[0]!.stepId : roleArg;
      const res = engine.submit(job, stepId, readFileSync(path, 'utf8'));
      if (res.ok) {
        json({ ok: true, jobId: id, stepId, state: job.record.state });
        return EXIT.OK;
      }
      if (res.kind === 'rejected') {
        json({ ok: false, kind: 'rejected', jobId: id, stepId, message: res.message });
        return EXIT.OTHER;
      }
      json({ ok: false, kind: 'schema', jobId: id, stepId, summary: res.summary, terminal: res.terminal, state: job.record.state, errors: res.errors.slice(0, 20) });
      return EXIT.SCHEMA_ERROR;
    }

    case 'finalize': {
      const engine = createEngine({ store: jobs, now });
      const job = openExisting(engine);
      if (typeof job === 'string') return fail(job);
      if (isTerminal(job.record.state)) {
        json({ jobId: job.record.jobId, state: job.record.state, report: job.record.report, decision: decisionJson(job), error: errorJson(job) });
        return job.record.state === 'COMPLETED' ? EXIT.OK : exitForState(job.record.state);
      }
      const claudeCliVersion = await (deps.claudeVersion ?? (() => realClaudeVersion(deps.env)))();
      try {
        engine.finalize(job, { save: reportSaver(reports, { claudeCliVersion }, now), claudeCliVersion });
      } catch (e) {
        if (e instanceof EngineError) return fail(e.message);
        throw e;
      }
      json({ jobId: job.record.jobId, state: job.record.state, report: job.record.report, decision: decisionJson(job), error: errorJson(job) });
      return exitForState(job.record.state);
    }

    case 'analyze':
      return analyze();

    case 'doctor': {
      const r = await runDiagnostics({
        net: deps.net ?? createRealNet(), env: deps.env, now,
        dirs: [{ label: 'reports/', path: join(deps.root, 'reports') }, { label: 'jobs/', path: join(deps.root, 'jobs') }],
        ...(deps.executable !== undefined ? { executable: deps.executable } : {}),
        claudeTest: v['claude-test'] === true,
        server: { port: parsePort(deps.env.PORT) ?? DEFAULT_PORT, mode: deps.env.FLOOR_LAN === '1' ? 'lan' : 'local', running: false },
        positions: () => positions.read(),
      });
      if (v.json) json(r);
      else deps.out(formatChecks(r.checks));
      return r.ok ? EXIT.OK : EXIT.OTHER;
    }

    case undefined:
    case 'help':
    case '--help':
      deps.out(USAGE);
      return cmd === undefined ? EXIT.OTHER : EXIT.OK;

    default:
      return fail(`알 수 없는 명령: ${String(cmd).slice(0, 40)}\n${USAGE}`);
  }

  async function analyze(): Promise<number> {
    const sm = symbolMode();
    if (typeof sm === 'string') return fail(sm);
    const demo = v.demo === true;
    if (v.scenario !== undefined && !demo) return fail('--scenario는 --demo와 함께만 씁니다');
    let scenario: DemoScenario | null = null;
    let clock = now;
    let acq: Acquirer;
    if (demo) {
      try {
        scenario = loadDemo(sm.mode, deps.demoDir, typeof v.scenario === 'string' ? v.scenario : undefined);
      } catch (e) {
        if (e instanceof DemoUnavailableError) return fail(e.message);
        throw e;
      }
      if (scenario.symbol.toUpperCase() !== sm.symbol.trim().toUpperCase()) return fail(`데모는 ${scenario.symbol} ${sm.mode}만 있습니다`);
      clock = demoClock(scenario);
      acq = demoAcquirer(scenario);
    } else {
      const check = await (deps.checkClaude ?? (() => realClaudeCheck(deps.env)))();
      if (!check.ok) return fail(`${check.code}: ${ERROR_CODES[check.code].message} (${check.detail})\n${DIAG_HINT}`);
      acq = (deps.acquirer ?? realAcquirer)(sm.symbol, sm.mode);
    }
    const demoBook = scenario;
    const engine = createEngine({ store: jobs, now: clock, positions: () => positions.read(), ...(demoBook ? { demoPositions: () => demoPositions(demoBook) } : {}) });
    engine.sweepAbandoned();
    const t0 = Date.now();
    const sec = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6);
    const job = await engine.createJob({ idempotencyKey: `cli-${randomUUID()}`, mode: sm.mode, symbolInput: sm.symbol, interface: 'web', demo }, acq);
    deps.err(`${sec()}s 작업 ${job.record.jobId} · ${job.record.instrumentId ?? sm.symbol} · ${sm.mode}${demo ? ' · DEMO' : ''} · ${job.record.state}`);

    if (!isTerminal(job.record.state)) {
      const base: ModelDriver = scenario
        ? demoDriver(scenario, job.snapshot!.snapshotId, deps.demoDelayMs ?? 0)
        : (deps.driver ?? ((e, j) => createClaudeCliDriver({ env: deps.env, onSpawn: (pid) => e.trackPid(j, pid), onExit: (pid) => e.untrackPid(j, pid) })))(engine, job);
      const driver: ModelDriver = {
        kind: base.kind, countsAsModelCall: base.countsAsModelCall,
        async call(req, signal) {
          deps.err(`${sec()}s → ${req.role}${base.kind === 'claude-cli' ? ` (${req.model}, effort ${req.effort ?? '-'})` : ''}`);
          const r = await base.call(req, signal);
          deps.err(`${sec()}s ← ${req.role} ${r.ok ? `ok ${r.outputChars}자${r.usage.outputTokens !== null ? ` · 출력 ${r.usage.outputTokens}토큰` : ''}${r.usage.costUsd !== null ? ` · $${r.usage.costUsd}` : ''}` : `${r.code} ${r.detail}`}`);
          return r;
        },
      };
      const ac = new AbortController();
      const onSig = () => ac.abort();
      process.once('SIGINT', onSig);
      deps.signal?.addEventListener('abort', onSig, { once: true });
      const claudeCliVersion = scenario ? 'none' : await (deps.claudeVersion ?? (() => realClaudeVersion(deps.env)))();
      try {
        await runJob(engine, job, driver, ac.signal, { save: reportSaver(reports, { claudeCliVersion }, clock), claudeCliVersion });
      } finally {
        process.removeListener('SIGINT', onSig);
      }
    }

    const r = job.record;
    if (v.json) {
      json({ jobId: r.jobId, state: r.state, demo, report: r.report, decision: decisionJson(job), usage: { modelCallCount: r.usage.modelCallCount, retryCallCount: r.usage.retryCallCount }, error: errorJson(job) });
    } else {
      deps.out(formatSummary(job, sec().trim()));
    }
    return exitForState(r.state);
  }
}

function formatSummary(job: Job, seconds: string): string {
  const r = job.record;
  const L: string[] = [];
  if (r.demo) L.push('[DEMO · 실제 데이터 아님]');
  L.push(`상태 ${r.state}${r.error ? ` · ${r.error.code} (${r.error.role ?? '-'}): ${r.error.detail}` : ''}`);
  if (r.error && errorJson(job)?.hint) L.push(DIAG_HINT);
  L.push(`호출 ${r.usage.modelCallCount}회 (계획 ${r.plannedModelCallRange.min}~${r.plannedModelCallRange.max}, 재시도 ${r.usage.retryCallCount}) · 토론 ${r.debate.roundCount}라운드 ${r.debate.stopReason ?? ''} · ${seconds}초`);
  const cost = r.usage.calls.reduce((s, c) => s + (c.usageReported?.costUsd ?? 0), 0);
  if (cost > 0) L.push(`보고 비용 $${cost.toFixed(4)}`);
  const d = r.finalDecision;
  if (d && d.action && d.bias) {
    const pv = panelView(d);
    L.push('', `[${pv.badges.join('] [')}] ${pv.title}`.replace('[] ', ''), `  ${pv.headline}${pv.headline === actionBiasLabel(d.action, d.bias) ? '' : ` (${actionBiasLabel(d.action, d.bias)})`}${d.confidence ? ` · 확신도 ${d.confidence.band} (${CONFIDENCE_NOTE})` : ''}`);
    for (const n of pv.notes) L.push(`  · ${n}`);
    if (d.proposal) L.push(`  진입 ${d.proposal.entry.type} ${d.proposal.entry.min ?? '-'}~${d.proposal.entry.max ?? '-'} · 손절 ${d.proposal.stopLoss ?? '-'} · 목표 ${d.proposal.targets.join(', ') || '-'}`);
    for (const x of d.ruleEngine.violations) L.push(`  ✗ ${x.code}: ${x.message}`);
  }
  if (r.report) L.push('', `리포트 ${r.report.md}`);
  return L.join('\n');
}

const MARK: Record<Check['status'], string> = { ok: '✓', warn: '!', error: '✗', skip: '-' };

function formatChecks(checks: Check[]): string {
  return checks.map((c) => `${MARK[c.status]} ${c.label}: ${c.detail}${c.hint && c.status !== 'ok' ? `\n    → ${c.hint}` : ''}`).join('\n');
}

const USAGE = `사용법:
  node src/cli/floor.ts analyze <종목> <모드> [--demo [--scenario <포지션 데모>]] [--json]
  node src/cli/floor.ts snapshot --symbol <종목> --mode <모드> [--interface floor|web]
  node src/cli/floor.ts next --job <jobId>
  node src/cli/floor.ts submit --job <jobId> --role <단계> --file <출력 JSON>
  node src/cli/floor.ts finalize --job <jobId>
  node src/cli/floor.ts doctor [--json] [--claude-test]
모드: algorithm(알고리즘) · scalp(스캘핑) · forced_direction(공격)`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await main(process.argv.slice(2), {
    root: process.env.FLOOR_HOME ? resolve(process.env.FLOOR_HOME) : PROJECT_ROOT,
    out: (s) => process.stdout.write(s + '\n'),
    err: (s) => process.stderr.write(s + '\n'),
    env: process.env,
  });
  process.exitCode = code;
}
