import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClockProbe } from '../../src/core/data/clock.ts';
import { NetError, type NetClient } from '../../src/core/data/net.ts';
import { runDiagnostics, type DiagOptions } from '../../src/core/diag.ts';
import type { ClaudeExecutable } from '../../src/core/model/claude-cli.ts';
import { replayAcquirer } from '../data-helpers.ts';
import { tempEngine } from '../job-helpers.ts';

const FAKE = fileURLToPath(new URL('../fixtures/fake-claude.mjs', import.meta.url));
const exe = (auth = 'claude.ai'): ClaudeExecutable => ({ command: process.execPath, prefixArgs: [FAKE, `--fake-auth=${auth}`], kind: 'native' });

/** 모든 요청에 성공하고, Date 헤더가 PC 시계보다 skewMs만큼 늦은 네트워크 */
function dateNet(skewMs: number, fail: string[] = []): NetClient & { urls: string[] } {
  const urls: string[] = [];
  return {
    kind: 'fixture', urls,
    async get(url) {
      urls.push(url);
      if (fail.some((f) => url.includes(f))) throw new NetError('NET_HTTP', `주입 실패 ${url}`);
      return { url, status: 200, body: '{}', date: new Date(Date.now() - skewMs).toUTCString(), fetchedAt: new Date().toISOString() };
    },
  };
}

function opts(over: Partial<DiagOptions> = {}): DiagOptions {
  const root = mkdtempSync(join(tmpdir(), 'floor-diag-'));
  return {
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
    nodeVersion: '22.18.0',
    now: () => new Date('2026-09-29T06:00:00Z'),
    net: dateNet(0),
    executable: exe(),
    dirs: [{ label: 'reports/', path: join(root, 'reports') }, { label: 'jobs/', path: join(root, 'jobs') }],
    ...over,
  };
}

const check = (r: Awaited<ReturnType<typeof runDiagnostics>>, id: string) => {
  const c = r.checks.find((x) => x.id === id);
  assert.ok(c, `검사 없음: ${id} (${r.checks.map((x) => x.id).join(', ')})`);
  return c;
};

test('정상 환경에서는 모든 필수 검사가 통과한다', async () => {
  const r = await runDiagnostics(opts());
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => c.status === 'error')));
  assert.equal(check(r, 'claude-cli').status, 'ok');
  assert.match(check(r, 'claude-version').detail, /2\.1\.284/);
  assert.equal(check(r, 'claude-auth').status, 'ok');
  assert.equal(check(r, 'claude-auth').detail, '구독 로그인');
  assert.equal(check(r, 'clock').status, 'ok');
  assert.equal(check(r, 'dir:reports/').status, 'ok');
  assert.ok(r.checks.some((c) => c.id.startsWith('provider:') && c.status === 'ok'));
  assert.equal(r.checks.find((c) => c.id === 'claude-test'), undefined); // 버튼을 눌렀을 때만
});

test('P1-8-T3 PC 시계가 2분 빠르면 진단에 시계 오류가 표시되고 실전 분석이 E-CLOCK으로 차단된다', async () => {
  const r = await runDiagnostics(opts({ net: dateNet(120_000) }));
  const c = check(r, 'clock');
  assert.equal(c.status, 'error');
  assert.match(c.detail, /12\d초 빠름/);
  assert.equal(r.ok, false);
  assert.ok(Math.abs(r.clockSkewMs! - 120_000) < 2000);

  // 실전 분석: 수집 중 잰 시계 오차가 60초를 넘으면 스냅샷·모델 호출 전에 끝난다
  const rep = replayAcquirer('btc-scalp');
  const t = tempEngine(rep.at);
  const probe = createClockProbe(dateNet(120_000));
  await probe.net.get('https://api.binance.com/api/v3/ping', 'json');
  const job = await t.engine.createJob({ idempotencyKey: 'k', mode: 'scalp', symbolInput: rep.symbol, interface: 'web' }, { ...rep.acquirer, clockSkewMs: probe.skewMs });
  assert.equal(job.record.state, 'FAILED');
  assert.equal(job.record.error?.code, 'E-CLOCK');
  assert.equal(job.record.snapshot, null);
  assert.equal(t.engine.next(job).kind, 'done');
});

test('시계 오차 30~60초는 경고만 남기고 분석을 계속한다', async () => {
  const r = await runDiagnostics(opts({ net: dateNet(-45_000) }));
  assert.equal(check(r, 'clock').status, 'warn');
  assert.match(check(r, 'clock').detail, /4\d초 느림/);
  const rep = replayAcquirer('btc-scalp');
  const t = tempEngine(rep.at);
  const job = await t.engine.createJob({ idempotencyKey: 'k', mode: 'scalp', symbolInput: rep.symbol, interface: 'web' }, { ...rep.acquirer, clockSkewMs: () => -45_000 });
  assert.equal(job.record.state, 'VALIDATING_DATA');
  assert.ok(job.record.warnings.some((w) => w.startsWith('시계 오차')));
});

test('P1-8-T4 Claude 미설치: CLI 검사가 실패하고 버전·인증 검사는 건너뛴다', async () => {
  const r = await runDiagnostics(opts({ executable: null }));
  const c = check(r, 'claude-cli');
  assert.equal(c.status, 'error');
  assert.equal(c.code, 'E-CLI-MISSING');
  assert.match(c.hint ?? '', /설치/);
  assert.equal(check(r, 'claude-version').status, 'skip');
  assert.equal(check(r, 'claude-auth').status, 'skip');
  assert.equal(r.ok, false);
});

test('P1-8-T4 미로그인: 인증 검사가 로그인 안내와 함께 실패한다 (이메일 등 비밀값 표시 없음)', async () => {
  const r = await runDiagnostics(opts({ executable: exe('none') }));
  const c = check(r, 'claude-auth');
  assert.equal(c.status, 'error');
  assert.equal(c.code, 'E-AUTH');
  assert.match(c.hint ?? '', /로그인/);
  assert.doesNotMatch(JSON.stringify(r), /secret-user/); // P1-8-R7
});

test('P1-8-T4 인증 방식은 구독 로그인 / API 키 / 확인 불가로만 표시한다', async () => {
  assert.equal(check(await runDiagnostics(opts({ executable: exe('apiKey') })), 'claude-auth').detail, 'API 키');
  const g = check(await runDiagnostics(opts({ executable: exe('garbage') })), 'claude-auth');
  assert.equal(g.status, 'warn');
  assert.equal(g.detail, '확인 불가');
});

test('P1-8-T4 API 키 환경변수가 있으면 경고하고 값은 표시하지 않는다 (P1-7-R6, P1-8-R7)', async () => {
  const secret = 'sk-ant-api03-SECRETVALUE';
  const r = await runDiagnostics(opts({ env: { PATH: process.env.PATH ?? '', ANTHROPIC_API_KEY: secret } }));
  const c = check(r, 'api-key-env');
  assert.equal(c.status, 'warn');
  assert.match(c.detail, /전달하지 않음/);
  assert.doesNotMatch(JSON.stringify(r), /SECRETVALUE/);
  const on = await runDiagnostics(opts({ env: { PATH: process.env.PATH ?? '', ANTHROPIC_API_KEY: secret, FLOOR_USE_API_KEY: '1' } }));
  assert.match(check(on, 'api-key-env').detail, /API 키 모드/);
  const none = await runDiagnostics(opts());
  assert.equal(check(none, 'api-key-env').status, 'ok');
});

test('Node 버전, 달력 포함 기간, 쓰기 권한, 공급자 연결 실패를 짚는다', async () => {
  assert.equal(check(await runDiagnostics(opts({ nodeVersion: '22.17.9' })), 'node').status, 'error');
  const cal = await runDiagnostics(opts({ now: () => new Date('2026-12-10T00:00:00Z') }));
  assert.equal(check(cal, 'calendar').status, 'warn');
  assert.match(check(cal, 'calendar').detail, /KRX/);
  const root = mkdtempSync(join(tmpdir(), 'floor-diag-'));
  const file = join(root, 'not-a-dir');
  writeFileSync(file, 'x');
  const w = await runDiagnostics(opts({ dirs: [{ label: 'reports/', path: join(file, 'reports') }] }));
  assert.equal(check(w, 'dir:reports/').status, 'error');
  const p = await runDiagnostics(opts({ net: dateNet(0, ['yahoo', 'coingecko']) }));
  assert.equal(check(p, 'provider:yahoo').status, 'error'); // 필수
  assert.equal(check(p, 'provider:coingecko').status, 'warn'); // 선택
});

test('Claude 시험 호출은 요청했을 때만 1회 실행한다', async () => {
  const r = await runDiagnostics(opts({ claudeTest: true }));
  const c = check(r, 'claude-test');
  assert.equal(c.status, 'ok', c.detail);
  assert.match(c.detail, /호출 1회/);
});

test('P1-8 진단 표: 포트 사용 가능 여부와 서버 모드(LAN이면 평문 경고)', async () => {
  const { createServer } = await import('node:net');
  const busy = createServer();
  await new Promise<void>((r) => busy.listen(0, '127.0.0.1', r));
  const port = (busy.address() as { port: number }).port;
  try {
    const inUse = await runDiagnostics(opts({ server: { port, mode: 'local', running: false } }));
    assert.equal(check(inUse, 'port').status, 'warn');
    assert.match(check(inUse, 'port').hint ?? '', /서버 창/);
    assert.equal(check(inUse, 'server-mode').status, 'ok');
    const self = await runDiagnostics(opts({ server: { port, mode: 'lan', running: true } }));
    assert.equal(check(self, 'port').status, 'ok');
    assert.equal(check(self, 'server-mode').status, 'warn');
    assert.match(check(self, 'server-mode').detail, /암호화되지 않음/);
  } finally {
    busy.close();
  }
  const free = await runDiagnostics(opts({ server: { port, mode: 'local', running: false } }));
  assert.equal(check(free, 'port').status, 'ok');
  const none = await runDiagnostics(opts());
  assert.equal(none.checks.some((c) => c.id === 'port'), false);
});

test('P1-8.2 Node.js 보안 패치: 지원 LTS 계열의 알려진 보안 릴리스보다 오래되면 경고, LTS가 아닌 계열·지원 종료도 경고', async () => {
  const at = (v: string, now = '2026-09-29T00:00:00Z') => runDiagnostics(opts({ nodeVersion: v, now: () => new Date(now) })).then((d) => check(d, 'node'));
  const old = await at('22.22.0');
  assert.equal(old.status, 'warn');
  assert.match(old.detail, /22\.23\.2/);
  assert.match(old.hint ?? '', /nodejs\.org/);
  assert.equal((await at('22.23.2')).status, 'ok');
  assert.equal((await at('24.21.0')).status, 'ok');
  assert.equal((await at('24.18.0')).status, 'warn');
  assert.equal((await at('26.5.1')).status, 'ok');
  assert.equal((await at('25.9.0')).status, 'warn', '홀수 계열은 LTS가 아니다');
  assert.equal((await at('22.23.2', '2027-05-01T00:00:00Z')).status, 'warn', '지원 종료 뒤');
  assert.equal((await at('22.17.9')).status, 'error');
});
