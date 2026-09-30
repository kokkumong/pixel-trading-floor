// P1-11 예산 상한 실측 도구 (P1 명세 11장, P0 명세 8.2).
//   node scripts/measure-budget.ts run <종목> <모드> [--count N]     실전 분석을 N회 차례로 실행 (claude·외부 API 사용)
//   node scripts/measure-budget.ts report [--since <ISO 시각>] [--interface web|floor] [--json]
//     jobs/*/job.json의 호출별 기록(P0-8-R7)으로 백분위와 산출값을 계산해 명세 부록에 붙일 Markdown을 낸다
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { platform, release } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { plannedSteps } from '../src/cli/floor.ts';
import { ANALYSTS } from '../src/core/job/steps.ts';
import type { JobRecord } from '../src/core/job/record.ts';
import type { Mode, Role } from '../src/core/schema/types.ts';

/** 입력 상한을 올리지 않는 선 (P1-11.2: 넘으면 역할 입력 범위를 먼저 줄인다) */
export const INPUT_CEILING = 20_000;
/** 모드·종목 조합당 최소 표본 (P1-11.1) */
export const MIN_SAMPLE = 10;

/** 가장 가까운 순위 방식. 표본이 100건 미만이면 p99는 최댓값이다 */
export function percentile(xs: readonly number[], p: number): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

interface Stats {
  n: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
}
const stats = (xs: readonly number[]): Stats => ({ n: xs.length, p50: percentile(xs, 50), p95: percentile(xs, 95), p99: percentile(xs, 99), max: xs.length ? Math.max(...xs) : null });

export interface RoleStats {
  duration: Stats;
  inputChars: Stats;
  outputChars: Stats;
  retried: number;
  failed: number;
}

export interface ModeSummary {
  sample: number;
  byState: Record<string, number>;
  jobDuration: Stats;
  roles: Partial<Record<Role, RoleStats>>;
  models: string[];
  derived: {
    callTimeoutSeconds: Partial<Record<Role, number>>;
    callTimeoutMax: number | null;
    /** 순차 경로 단계별 p95 (애널리스트 병렬 단계는 `briefing`) */
    path: { step: string; p95: number | null }[];
    maxDurationSeconds: number | null;
    maxInputChars: Partial<Record<Role, number>>;
    maxOutputChars: Partial<Record<Role, number>>;
    inputOverLimit: Role[];
  };
  /** 산출값을 확정해도 되는지 (P1-11-R2·R3, 표본 수) */
  final: boolean;
  notes: string[];
}

export interface Summary {
  filter: { interface: 'web' | 'floor'; since: string | null };
  modes: Partial<Record<Mode, ModeSummary>>;
}

const seconds = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 1000;
const ceil = (x: number | null) => (x === null ? null : Math.ceil(x));

function summarizeMode(mode: Mode, jobs: JobRecord[]): ModeSummary {
  const byState: Record<string, number> = {};
  for (const j of jobs) byState[j.state] = (byState[j.state] ?? 0) + 1;
  const calls = jobs.flatMap((j) => j.usage.calls);
  const roles: Partial<Record<Role, RoleStats>> = {};
  for (const role of [...new Set(calls.map((c) => c.role))]) {
    const cs = calls.filter((c) => c.role === role);
    roles[role] = {
      duration: stats(cs.map((c) => c.durationSeconds)),
      inputChars: stats(cs.map((c) => c.inputChars)),
      outputChars: stats(cs.map((c) => c.outputChars)),
      retried: cs.filter((c) => c.retried).length,
      failed: cs.filter((c) => c.outcome !== 'ok').length,
    };
  }

  const derived: ModeSummary['derived'] = { callTimeoutSeconds: {}, callTimeoutMax: null, path: [], maxDurationSeconds: null, maxInputChars: {}, maxOutputChars: {}, inputOverLimit: [] };
  for (const [role, r] of Object.entries(roles) as [Role, RoleStats][]) {
    derived.callTimeoutSeconds[role] = ceil(r.duration.p99! * 1.5)!;
    const input = Math.ceil(r.inputChars.p99! * 1.2);
    if (input > INPUT_CEILING) derived.inputOverLimit.push(role);
    derived.maxInputChars[role] = Math.min(input, INPUT_CEILING);
    derived.maxOutputChars[role] = Math.ceil(r.outputChars.p99! * 1.5);
  }
  const timeouts = Object.values(derived.callTimeoutSeconds);
  derived.callTimeoutMax = timeouts.length ? Math.max(...timeouts) : null;

  // 순차 경로(P0-8.2): 애널리스트 병렬 단계 1개 + 계획상 나머지 단계 전부(토론은 최대 라운드). 재시도는 뒤 항(최대 호출 제한)이 여유분이다
  if (calls.length) {
    const analysts: readonly Role[] = ANALYSTS[mode];
    const briefing = jobs
      .map((j) => j.usage.calls.filter((c) => analysts.includes(c.role) && !c.retried))
      .filter((cs) => cs.length > 0)
      .map((cs) => Math.max(...cs.map((c) => Date.parse(c.startedAt) + c.durationSeconds * 1000)) / 1000 - Math.min(...cs.map((c) => Date.parse(c.startedAt))) / 1000);
    derived.path.push({ step: 'briefing', p95: percentile(briefing, 95) });
    for (const { stepId } of plannedSteps(mode)) {
      const role = stepId.replace(/-\d+$/, '') as Role;
      if (analysts.includes(role)) continue;
      derived.path.push({ step: stepId, p95: percentile(calls.filter((c) => c.role === role && !c.retried).map((c) => c.durationSeconds), 95) });
    }
    const known = derived.path.every((s) => s.p95 !== null);
    derived.maxDurationSeconds = known && derived.callTimeoutMax !== null ? Math.ceil(derived.path.reduce((s, x) => s + x.p95!, 0)) + derived.callTimeoutMax : null;
  }

  const notes: string[] = [];
  if (jobs.length < MIN_SAMPLE) notes.push(`표본 ${jobs.length}건 (최소 ${MIN_SAMPLE}건)`);
  if (byState.BUDGET_EXCEEDED) notes.push(`BUDGET_EXCEEDED ${byState.BUDGET_EXCEEDED}건: 원인 확인 전에는 확정하지 않음 (P1-11-R2)`);
  const models = [...new Set(calls.map((c) => c.modelId).filter((m): m is string => !!m))].sort();
  if (models.length > 1) notes.push(`모델이 섞임 (${models.join(', ')}): 재측정 대상 (P1-11-R3)`);
  const mixedPrompts = [...new Set(jobs.flatMap((j) => Object.keys(j.promptHashes ?? {})))].filter((role) => new Set(jobs.map((j) => (j.promptHashes as Record<string, string>)?.[role]).filter(Boolean)).size > 1);
  if (mixedPrompts.length) notes.push(`프롬프트 해시가 섞임 (${mixedPrompts.join(', ')}): 재측정 대상 (P1-11-R3)`);
  if (derived.inputOverLimit.length) notes.push(`입력 p99×1.2가 ${INPUT_CEILING}자를 넘는 역할 (${derived.inputOverLimit.join(', ')}): 입력 범위를 먼저 줄인다`);
  if (derived.path.some((s) => s.p95 === null)) notes.push(`순차 경로에 표본 없는 단계가 있음 (${derived.path.filter((s) => s.p95 === null).map((s) => s.step).join(', ')})`);

  const jobDurations = jobs.map((j) => seconds(j.history[0]!.at, j.history[j.history.length - 1]!.at));
  return { sample: jobs.length, byState, jobDuration: stats(jobDurations), roles, models, derived, final: notes.length === 0, notes };
}

export function summarize(jobs: readonly JobRecord[], opts: { interface?: 'web' | 'floor'; since?: string } = {}): Summary {
  const iface = opts.interface ?? 'web';
  const since = opts.since ? Date.parse(opts.since) : null;
  const picked = jobs.filter((j) => !j.demo && j.interface === iface && (since === null || Date.parse(j.createdAt) >= since) && j.history.length > 0);
  const modes: Partial<Record<Mode, ModeSummary>> = {};
  for (const mode of ['algorithm', 'scalp', 'forced_direction'] as const) {
    const js = picked.filter((j) => j.mode === mode);
    if (js.length) modes[mode] = summarizeMode(mode, js);
  }
  return { filter: { interface: iface, since: opts.since ?? null }, modes };
}

const n = (x: number | null) => (x === null ? '-' : Number.isInteger(x) ? x.toLocaleString('en-US') : x.toFixed(1));

/** P0 명세 부록에 붙일 표 (P1-11-R1·T2: 측정 날짜, 환경, 버전, 표본 수) */
export function toMarkdown(s: Summary, meta: { measuredAt: string; environment: string; claudeCliVersion: string }): string {
  const L: string[] = [];
  L.push(`- 측정일: ${meta.measuredAt} · 환경: ${meta.environment} · Claude Code ${meta.claudeCliVersion} · 인터페이스: ${s.filter.interface}${s.filter.since ? ` · ${s.filter.since} 이후` : ''}`);
  L.push('', '| 모드 | 표본 | 종료 상태 | 작업 시간 p50/p95/최대(초) | 모델 | 확정 |', '|---|---|---|---|---|---|');
  for (const [mode, m] of Object.entries(s.modes) as [Mode, ModeSummary][]) {
    const states = Object.entries(m.byState).map(([k, v]) => `${k} ${v}`).join(', ');
    L.push(`| ${mode} | ${m.sample} | ${states} | ${n(m.jobDuration.p50)} / ${n(m.jobDuration.p95)} / ${n(m.jobDuration.max)} | ${m.models.join(', ') || '-'} | ${m.final ? '예' : '아니오'} |`);
  }
  for (const [mode, m] of Object.entries(s.modes) as [Mode, ModeSummary][]) {
    L.push('', `**${mode}** 역할별 (초·자)`, '', '| 역할 | 호출 | 시간 p50/p95/p99 | 입력 p99 | 출력 p99 | 재시도 | 실패 | callTimeoutSeconds | maxInputChars | maxOutputChars |', '|---|---|---|---|---|---|---|---|---|---|');
    for (const [role, r] of Object.entries(m.roles) as [Role, RoleStats][]) {
      L.push(`| ${role} | ${r.duration.n} | ${n(r.duration.p50)} / ${n(r.duration.p95)} / ${n(r.duration.p99)} | ${n(r.inputChars.p99)} | ${n(r.outputChars.p99)} | ${r.retried} | ${r.failed} | ${m.derived.callTimeoutSeconds[role]} | ${n(m.derived.maxInputChars[role] ?? null)} | ${n(m.derived.maxOutputChars[role] ?? null)} |`);
    }
    const path = m.derived.path.map((p) => `${p.step} ${n(p.p95)}`).join(' + ');
    L.push('', `- 산출: callTimeoutSeconds 최대 ${n(m.derived.callTimeoutMax)} · maxDurationSeconds = (${path || '-'}) + ${n(m.derived.callTimeoutMax)} = **${n(m.derived.maxDurationSeconds)}**`);
    for (const note of m.notes) L.push(`- 주의: ${note}`);
  }
  return L.join('\n');
}

function loadJobs(root: string): JobRecord[] {
  const dir = join(root, 'jobs');
  if (!existsSync(dir)) return [];
  const out: JobRecord[] = [];
  for (const id of readdirSync(dir)) {
    const p = join(dir, id, 'job.json');
    if (!existsSync(p)) continue;
    try {
      out.push(JSON.parse(readFileSync(p, 'utf8')) as JobRecord);
    } catch {
      // 쓰는 도중인 파일은 건너뛴다
    }
  }
  return out;
}

function claudeVersion(): string {
  // 인증 문제로 멈출 수 있어 시간 제한을 둔다 (ARCHITECTURE.md claude -p 호출 규약)
  const r = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 15_000 });
  return r.status === 0 ? r.stdout.trim().split(/\s/)[0]! : '알 수 없음';
}

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function main(argv: string[]): number {
  const [cmd, ...rest] = argv;
  const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { count: { type: 'string' }, since: { type: 'string' }, interface: { type: 'string' }, json: { type: 'boolean' } } });
  if (cmd === 'report') {
    const iface = values.interface === 'floor' ? 'floor' : 'web';
    const s = summarize(loadJobs(process.env.FLOOR_HOME ? resolve(process.env.FLOOR_HOME) : ROOT), { interface: iface, ...(values.since ? { since: values.since } : {}) });
    if (values.json) process.stdout.write(JSON.stringify(s, null, 2) + '\n');
    else process.stdout.write(toMarkdown(s, { measuredAt: new Date().toISOString().slice(0, 10), environment: `${platform()} ${release()} · Node ${process.version}`, claudeCliVersion: claudeVersion() }) + '\n');
    return 0;
  }
  if (cmd === 'run') {
    const [symbol, mode] = positionals;
    const count = Number(values.count ?? '1');
    if (!symbol || !mode || !Number.isInteger(count) || count < 1 || count > 20) {
      process.stderr.write('사용법: node scripts/measure-budget.ts run <종목> <모드> [--count 1~20]\n');
      return 1;
    }
    let bad = 0;
    for (let i = 1; i <= count; i++) {
      // 인자는 배열로 넘기고 셸을 거치지 않는다. analyze가 호출마다 시간 제한과 작업 예산을 적용한다
      const r = spawnSync(process.execPath, [join(ROOT, 'src', 'cli', 'floor.ts'), 'analyze', symbol, mode, '--json'], { encoding: 'utf8', cwd: ROOT, timeout: 20 * 60_000, stdio: ['ignore', 'pipe', 'inherit'] });
      let line = `${i}/${count} 종료 코드 ${r.status}`;
      try {
        const j = JSON.parse(r.stdout) as { jobId: string; state: string; usage: { modelCallCount: number; retryCallCount: number } };
        line += ` · ${j.state} · 호출 ${j.usage.modelCallCount} · 재시도 ${j.usage.retryCallCount} · ${j.jobId}`;
      } catch {
        line += ' · 결과 JSON 없음';
      }
      if (r.status !== 0) bad++;
      process.stdout.write(line + '\n');
    }
    return bad ? 1 : 0;
  }
  process.stderr.write('사용법: node scripts/measure-budget.ts <run <종목> <모드> [--count N] | report [--since ISO] [--interface web|floor] [--json]>\n');
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
