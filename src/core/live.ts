// 실전 연결: 네트워크 획득기와 Claude CLI 확인. CLI(analyze)와 HTTP 서버가 같은 함수를 쓴다.
import { yahooUsLookup } from './data/adapters.ts';
import { createClockProbe } from './data/clock.ts';
import { createRealNet } from './data/net.ts';
import { InstrumentRegistry } from './data/registry.ts';
import { collectSources } from './data/snapshot.ts';
import { authMethodLabel } from './diag.ts';
import type { Acquirer } from './job/engine.ts';
import { findClaudeExecutable, runClaudeCommand } from './model/claude-cli.ts';
import type { ErrorCode } from './model/errors.ts';
import type { Mode } from './schema/types.ts';

export type ClaudeCheck = { ok: true } | { ok: false; code: ErrorCode; detail: string };

/** 실전 데이터 획득기: 네트워크 + 수집 중 시계 오차 측정 (E-CLOCK) */
export function realAcquirer(symbol: string, mode: Mode): Acquirer {
  const probe = createClockProbe(createRealNet());
  const registry = new InstrumentRegistry();
  return {
    registryVersion: registry.version,
    resolve: () => registry.resolveWithLookup(symbol, mode, yahooUsLookup(probe.net)),
    collect: (inst) => collectSources(probe.net, inst, mode),
    clockSkewMs: probe.skewMs,
  };
}

/** 실전 분석 전 확인: 실행 파일과 로그인. 인증이 없으면 claude -p가 무기한 대기하므로 먼저 본다 (스파이크 결과) */
export async function realClaudeCheck(env: NodeJS.ProcessEnv): Promise<ClaudeCheck> {
  const exe = findClaudeExecutable(env);
  if (!exe) return { ok: false, code: 'E-CLI-MISSING', detail: 'claude 실행 파일을 찾지 못함' };
  const a = await runClaudeCommand(exe, ['auth', 'status', '--json'], { env, timeoutMs: 15_000 });
  if (authMethodLabel(a.stdout).loggedIn === false) return { ok: false, code: 'E-AUTH', detail: 'claude auth status: 로그인되어 있지 않음' };
  return { ok: true };
}

export async function realClaudeVersion(env: NodeJS.ProcessEnv): Promise<string> {
  const exe = findClaudeExecutable(env);
  if (!exe) return 'unknown';
  const v = await runClaudeCommand(exe, ['--version'], { env, timeoutMs: 15_000 });
  return v.stdout.trim().split('\n')[0]?.slice(0, 80) || 'unknown';
}

/** 진단 페이지로 안내할 오류 (P1-8-R6) */
export function needsDiagnostics(code: ErrorCode | null | undefined): boolean {
  return code === 'E-CLI-MISSING' || code === 'E-AUTH' || code === 'E-CLOCK';
}
