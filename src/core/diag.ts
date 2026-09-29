// 통합 진단 (P1 명세 8.2). `floor doctor`와 /diagnostics(Phase 6)가 같은 검사를 쓴다.
// 결과에 비밀값(토큰, 키, 이메일)을 넣지 않는다 (P1-8-R7). 인증 방식은 구독 로그인 / API 키 / 확인 불가로만 표시한다.
// 서버 관련 검사(포트, 서버 모드)는 server 옵션이 있을 때만 한다 (/diagnostics: 실행 중인 서버, doctor: 시작 전 확인).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { calendarCoverageWarnings } from './data/calendar.ts';
import { createClockProbe, judgeClock } from './data/clock.ts';
import type { Expect, NetClient } from './data/net.ts';
import { createClaudeCliDriver, findClaudeExecutable, runClaudeCommand, type ClaudeExecutable } from './model/claude-cli.ts';
import type { ErrorCode } from './model/errors.ts';

export const MIN_NODE_VERSION = '22.18.0';
/**
 * 지원 LTS 계열별 알려진 최신 보안 릴리스와 지원 종료일 (nodejs.org/dist/index.json, nodejs/Release schedule.json 기준, 2026-09-29 확인).
 * `node:http` 취약점은 Node 업데이트로만 막히므로 이보다 오래되면 경고한다. 앱은 실행 중에 nodejs.org를 조회하지 않는다 (P0-6-R1 목적지 목록 유지).
 * 새 보안 릴리스가 나오면 이 표를 갱신한다
 */
export const NODE_SECURITY_BASELINE = {
  checkedAt: '2026-09-29',
  lines: {
    22: { minPatch: '22.23.2', released: '2026-07-28', end: '2027-04-30' },
    24: { minPatch: '24.18.1', released: '2026-07-28', end: '2028-04-30' },
    26: { minPatch: '26.5.1', released: '2026-07-28', end: '2029-04-30' },
  } as Record<number, { minPatch: string; released: string; end: string }>,
} as const;

/** Node 버전 검사: 최소 버전 미만은 오류, LTS가 아닌 계열·지원 종료·알려진 보안 릴리스 미만은 경고 */
export function nodeCheck(version: string, now: Date): Check {
  const base = { id: 'node', label: 'Node.js 버전' };
  const hint = 'https://nodejs.org 에서 최신 LTS를 설치하세요 (보안 패치는 Node 업데이트로만 받습니다)';
  if (compareVersions(version, MIN_NODE_VERSION) < 0) return { ...base, status: 'error', detail: `${version} (필요: ${MIN_NODE_VERSION} 이상)`, hint };
  const line = NODE_SECURITY_BASELINE.lines[Number(version.split('.')[0])];
  if (!line) return { ...base, status: 'warn', detail: `${version} (LTS 계열이 아니라 보안 패치 여부를 확인할 수 없음)`, hint };
  if (now.toISOString().slice(0, 10) > line.end) return { ...base, status: 'warn', detail: `${version} (이 계열은 ${line.end}에 지원 종료)`, hint };
  if (compareVersions(version, line.minPatch) < 0) {
    return { ...base, status: 'warn', detail: `${version} (보안 릴리스 ${line.minPatch}(${line.released})보다 오래됨, ${NODE_SECURITY_BASELINE.checkedAt} 기준)`, hint };
  }
  return { ...base, status: 'ok', detail: version };
}
/** claude -p 호출 규약을 확인한 버전 (CLAUDE.md 스파이크: --safe-mode, --json-schema, structured_output) */
export const MIN_CLAUDE_VERSION = '2.1.280';

export type CheckStatus = 'ok' | 'warn' | 'error' | 'skip';

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  hint?: string;
  code?: ErrorCode;
}

export interface DiagOptions {
  net: NetClient;
  dirs: { label: string; path: string }[];
  env?: NodeJS.ProcessEnv;
  nodeVersion?: string;
  now?: () => Date;
  /** undefined면 PATH에서 찾는다 */
  executable?: ClaudeExecutable | null;
  /** Claude 시험 호출 (사용자가 요청했을 때만, 호출 1회 소모) */
  claudeTest?: boolean;
  /** 포트·서버 모드 검사. running이면 이 서버가 그 포트를 쓰는 중이다 */
  server?: { port: number; mode: 'local' | 'lan'; running: boolean };
}

export const LAN_WARNING = 'LAN 공유 중 · 암호화되지 않음';

/** 127.0.0.1에서 잠깐 열어 본다 */
export function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

export interface DiagResult {
  checks: Check[];
  ok: boolean;
  clockSkewMs: number | null;
}

/** 공급자별 가벼운 요청. required는 해당 시장 분석의 필수 소스 공급자 (P0-4.3) */
export const PROVIDER_PROBES: readonly { id: string; label: string; url: string; expect: Expect; required: boolean }[] = [
  { id: 'binance-spot', label: 'Binance 현물', url: 'https://api.binance.com/api/v3/ping', expect: 'json', required: true },
  { id: 'binance-perp', label: 'Binance 무기한', url: 'https://fapi.binance.com/fapi/v1/ping', expect: 'json', required: true },
  { id: 'yahoo', label: 'Yahoo Finance', url: 'https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?range=1d&interval=1d', expect: 'json', required: true },
  { id: 'coingecko', label: 'CoinGecko', url: 'https://api.coingecko.com/api/v3/ping', expect: 'json', required: false },
  { id: 'alternative', label: '공포탐욕지수', url: 'https://api.alternative.me/fng/?limit=1', expect: 'json', required: false },
  { id: 'google-news', label: 'Google 뉴스 RSS', url: 'https://news.google.com/rss/search?q=bitcoin&hl=ko&gl=KR&ceid=KR:ko', expect: 'xml', required: false },
  { id: 'bybit', label: 'Bybit', url: 'https://api.bybit.com/v5/market/time', expect: 'json', required: false },
  { id: 'bitget', label: 'Bitget', url: 'https://api.bitget.com/api/v2/public/time', expect: 'json', required: false },
  { id: 'gate', label: 'Gate', url: 'https://api.gateio.ws/api/v4/spot/time', expect: 'json', required: false },
];

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

/** auth status 출력에서 인증 방식만 읽는다. 이메일·조직 등 다른 필드는 버린다 */
export function authMethodLabel(stdout: string): { loggedIn: boolean | null; label: '구독 로그인' | 'API 키' | '확인 불가' } {
  let j: { loggedIn?: unknown; authMethod?: unknown };
  try {
    j = JSON.parse(stdout);
  } catch {
    return { loggedIn: null, label: '확인 불가' };
  }
  if (j.loggedIn === false) return { loggedIn: false, label: '확인 불가' };
  const m = typeof j.authMethod === 'string' ? j.authMethod : '';
  if (j.loggedIn === true && /api.?key/i.test(m)) return { loggedIn: true, label: 'API 키' };
  if (j.loggedIn === true && /claude\.ai|oauth|subscription/i.test(m)) return { loggedIn: true, label: '구독 로그인' };
  return { loggedIn: j.loggedIn === true ? true : null, label: '확인 불가' };
}

export async function runDiagnostics(o: DiagOptions): Promise<DiagResult> {
  const env = o.env ?? process.env;
  const now = o.now ?? (() => new Date());
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  // Node.js
  const nodeV = o.nodeVersion ?? process.versions.node;
  add(nodeCheck(nodeV, now()));

  // Claude CLI: 존재·실행 방식 → 버전 → 인증
  const exe = o.executable === undefined ? findClaudeExecutable(env) : o.executable;
  if (!exe) {
    add({ id: 'claude-cli', label: 'Claude CLI', status: 'error', code: 'E-CLI-MISSING', detail: '실행 파일을 찾지 못함', hint: 'Claude Code 네이티브 설치 후 터미널을 다시 여세요 (https://claude.com/claude-code)' });
    add({ id: 'claude-version', label: 'Claude CLI 버전', status: 'skip', detail: 'CLI 없음' });
    add({ id: 'claude-auth', label: '인증 방식', status: 'skip', detail: 'CLI 없음' });
  } else {
    add({ id: 'claude-cli', label: 'Claude CLI', status: 'ok', detail: exe.kind === 'native' ? '실행 파일 직접 실행' : 'Node + cli.js 직접 실행 (npm 설치)' });
    const v = await runClaudeCommand(exe, ['--version'], { env, timeoutMs: 15_000 });
    const ver = /(\d+\.\d+\.\d+)/.exec(v.stdout)?.[1] ?? null;
    if (!ver) add({ id: 'claude-version', label: 'Claude CLI 버전', status: 'error', code: 'E-CLI-MISSING', detail: v.timedOut ? '응답 없음' : '버전을 읽지 못함', hint: 'claude --version이 동작하는지 확인하세요' });
    else if (compareVersions(ver, MIN_CLAUDE_VERSION) < 0) add({ id: 'claude-version', label: 'Claude CLI 버전', status: 'error', detail: `${ver} (필요: ${MIN_CLAUDE_VERSION} 이상)`, hint: 'claude update로 업데이트하세요' });
    else add({ id: 'claude-version', label: 'Claude CLI 버전', status: 'ok', detail: ver });

    const a = await runClaudeCommand(exe, ['auth', 'status', '--json'], { env, timeoutMs: 15_000 });
    const auth = authMethodLabel(a.stdout);
    if (auth.loggedIn === false) add({ id: 'claude-auth', label: '인증 방식', status: 'error', code: 'E-AUTH', detail: '로그인되어 있지 않음', hint: '터미널에서 claude를 실행해 로그인하세요' });
    else if (auth.label === '확인 불가') add({ id: 'claude-auth', label: '인증 방식', status: 'warn', detail: '확인 불가', hint: a.timedOut ? 'claude auth status가 응답하지 않습니다' : '터미널에서 claude auth status로 확인하세요' });
    else add({ id: 'claude-auth', label: '인증 방식', status: 'ok', detail: auth.label });
  }

  // API 키 환경변수 (P1-7-R6): 값은 표시하지 않는다
  if (env.ANTHROPIC_API_KEY) {
    add(env.FLOOR_USE_API_KEY === '1'
      ? { id: 'api-key-env', label: 'API 키 환경변수', status: 'warn', detail: 'API 키 모드: 분석 호출이 API 사용량으로 과금됩니다', hint: '구독으로 쓰려면 FLOOR_USE_API_KEY를 지우세요' }
      : { id: 'api-key-env', label: 'API 키 환경변수', status: 'warn', detail: 'ANTHROPIC_API_KEY 감지 — 분석 프로세스에 전달하지 않음 (구독 로그인 사용)', hint: 'API 키로 과금하려면 FLOOR_USE_API_KEY=1을 설정하세요' });
  } else {
    add({ id: 'api-key-env', label: 'API 키 환경변수', status: 'ok', detail: '없음' });
  }

  // 데이터 공급자 연결과 시계 오차 (같은 요청의 Date 헤더로 잰다)
  const clockProbe = createClockProbe(o.net); // 실제 PC 시계와 비교한다
  const results = await Promise.all(PROVIDER_PROBES.map(async (p): Promise<Check> => {
    try {
      await clockProbe.net.get(p.url, p.expect);
      return { id: `provider:${p.id}`, label: p.label, status: 'ok', detail: p.required ? '필수 · 연결됨' : '선택 · 연결됨' };
    } catch (e) {
      return { id: `provider:${p.id}`, label: p.label, status: p.required ? 'error' : 'warn', detail: `${p.required ? '필수' : '선택'} · ${(e as Error).message}`, hint: '네트워크·방화벽을 확인하세요' };
    }
  }));
  checks.push(...results);
  const skew = clockProbe.skewMs();
  if (skew === null) {
    add({ id: 'clock', label: '시계 오차', status: 'skip', detail: '공급자 응답 시각을 받지 못해 확인 불가' });
  } else {
    const c = judgeClock(skew);
    add({ id: 'clock', label: '시계 오차', status: c.level, detail: c.message, ...(c.level === 'error' ? { code: 'E-CLOCK' as const } : {}), ...(c.level !== 'ok' ? { hint: '운영체제의 시간 자동 동기화를 켜세요' } : {}) });
  }

  // 거래소 달력 포함 기간
  const cal = calendarCoverageWarnings(now());
  add(cal.length ? { id: 'calendar', label: '거래소 달력', status: 'warn', detail: cal.join(' / '), hint: 'src/core/data/calendars.json에 휴장일을 추가하세요' } : { id: 'calendar', label: '거래소 달력', status: 'ok', detail: '모든 달력이 30일 넘게 남음' });

  // 쓰기 권한
  for (const d of o.dirs) {
    try {
      mkdirSync(d.path, { recursive: true });
      const f = join(d.path, `.doctor-${process.pid}-${Date.now()}`);
      writeFileSync(f, 'ok');
      rmSync(f, { force: true });
      add({ id: `dir:${d.label}`, label: `${d.label} 쓰기`, status: 'ok', detail: d.path });
    } catch (e) {
      add({ id: `dir:${d.label}`, label: `${d.label} 쓰기`, status: 'error', code: 'E-DISK', detail: (e as Error).message, hint: '폴더 권한과 디스크 공간을 확인하세요' });
    }
  }

  // 포트와 서버 모드
  if (o.server) {
    const { port, mode, running } = o.server;
    if (running) add({ id: 'port', label: '포트', status: 'ok', detail: `${port} · 이 서버가 사용 중` });
    else if (await portAvailable(port)) add({ id: 'port', label: '포트', status: 'ok', detail: `${port} · 사용 가능` });
    else add({ id: 'port', label: '포트', status: 'warn', detail: `${port} · 이미 사용 중`, hint: '먼저 켜져 있던 서버 창을 닫거나 PORT 환경변수로 포트를 바꾸세요' });
    add(mode === 'lan'
      ? { id: 'server-mode', label: '서버 모드', status: 'warn', detail: `${LAN_WARNING} — 토큰은 무단 접근을 막지만 도청은 막지 못합니다`, hint: '집·사무실의 신뢰할 수 있는 Wi-Fi에서만 쓰세요. 공용·게스트 Wi-Fi 금지' }
      : { id: 'server-mode', label: '서버 모드', status: 'ok', detail: '로컬 전용 (127.0.0.1)' });
  }

  // Claude 시험 호출 (선택, 호출 1회)
  if (o.claudeTest) {
    if (!exe) {
      add({ id: 'claude-test', label: 'Claude 시험 호출', status: 'skip', detail: 'CLI 없음' });
    } else {
      const driver = createClaudeCliDriver({ executable: exe, env });
      const r = await driver.call({
        role: 'TARO', systemPrompt: '{"ok": true}만 출력한다.', input: '시험 호출', model: 'haiku', timeoutMs: 90_000, maxOutputChars: 2000,
        jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
      }, new AbortController().signal);
      add(r.ok
        ? { id: 'claude-test', label: 'Claude 시험 호출', status: 'ok', detail: `성공 · 호출 1회 · ${(r.durationMs / 1000).toFixed(1)}초 · ${r.modelId}` }
        : { id: 'claude-test', label: 'Claude 시험 호출', status: 'error', code: r.code, detail: `${r.code} · 호출 1회`, hint: '오류 코드 안내를 확인하세요' });
    }
  }

  return { checks, ok: !checks.some((c) => c.status === 'error'), clockSkewMs: skew };
}
