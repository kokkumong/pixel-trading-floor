import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedHosts, allowedLocalAddress, checkFetchSite, checkHost, checkOrigin, decideAccess, isLoopback, isPrivateIPv4, LAN_TOKEN_TTL_MS, LanAuth,
  LOCAL_SESSION_COOKIE, MAX_LAN_SESSIONS, parseCookies, RateLimiter, redact, sessionCookie,
} from '../../src/server/security.ts';

test('P0-7-R1 LAN 토큰은 128비트 이상 난수이고 시작(생성)마다 다르다', () => {
  const a = new LanAuth();
  const b = new LanAuth();
  assert.notEqual(a.token, b.token);
  assert.ok(Buffer.from(a.token, 'base64url').length >= 16);
});

test('P0-7-T2 토큰은 2시간 뒤 만료되고, 세션 쿠키도 만료된다', () => {
  const clock = { t: 1_000_000 };
  const auth = new LanAuth({ now: () => clock.t });
  assert.equal(auth.verifyToken(auth.token), true);
  assert.equal(auth.verifyToken('x'.repeat(22)), false);
  assert.equal(auth.verifyToken(''), false);
  const s = auth.createSession();
  assert.equal(auth.verifySession(s.id), true);
  assert.ok(s.maxAgeSeconds !== null && s.maxAgeSeconds > 0 && s.maxAgeSeconds <= LAN_TOKEN_TTL_MS / 1000);
  clock.t += LAN_TOKEN_TTL_MS + 1;
  assert.equal(auth.verifyToken(auth.token), false);
  assert.equal(auth.verifySession(s.id), false);
});

test('P0-7-T6 토큰을 재발급하면 기존 토큰과 쿠키가 모두 무효가 된다', () => {
  const auth = new LanAuth();
  const old = auth.token;
  const s = auth.createSession();
  auth.rotate();
  assert.notEqual(auth.token, old);
  assert.equal(auth.verifyToken(old), false);
  assert.equal(auth.verifySession(s.id), false);
  assert.equal(auth.verifyToken(auth.token), true);
});

test('P0-7-T3 Host 허용 목록: 로컬은 localhost·127.0.0.1, LAN은 감지한 IPv4 추가', () => {
  const local = allowedHosts(8000, 'local', ['192.168.0.12']);
  assert.ok(checkHost('localhost:8000', local));
  assert.ok(checkHost('127.0.0.1:8000', local));
  assert.ok(checkHost('LOCALHOST:8000', local));
  assert.equal(checkHost('192.168.0.12:8000', local), false);
  assert.equal(checkHost('evil.example', local), false);
  assert.equal(checkHost('evil.example:8000', local), false);
  assert.equal(checkHost('localhost:8001', local), false);
  assert.equal(checkHost(undefined, local), false);
  const lan = allowedHosts(8000, 'lan', ['192.168.0.12']);
  assert.ok(checkHost('192.168.0.12:8000', lan));
  assert.equal(checkHost('evil.example:8000', lan), false);
});

test('P0-7-R6 상태를 바꾸는 요청의 Origin은 허용 출처와 정확히 같아야 한다', () => {
  const hosts = allowedHosts(8000, 'local', []);
  assert.ok(checkOrigin('http://localhost:8000', hosts));
  assert.ok(checkOrigin('http://127.0.0.1:8000', hosts));
  assert.equal(checkOrigin(undefined, hosts), false);
  assert.equal(checkOrigin('null', hosts), false);
  assert.equal(checkOrigin('https://localhost:8000', hosts), false);
  assert.equal(checkOrigin('http://evil.example', hosts), false);
  assert.equal(checkOrigin('http://localhost:8000.evil.example', hosts), false);
});

test('P0-7-R7 요청 횟수 제한: 1분 창 안에서 한도를 넘으면 거부, 창이 지나면 다시 허용', () => {
  const clock = { t: 0 };
  const rl = new RateLimiter(() => clock.t);
  for (let i = 0; i < 3; i++) assert.ok(rl.hit('1.2.3.4|analyze', 3));
  assert.equal(rl.hit('1.2.3.4|analyze', 3), false);
  assert.ok(rl.hit('5.6.7.8|analyze', 3)); // IP별
  clock.t += 60_001;
  assert.ok(rl.hit('1.2.3.4|analyze', 3));
});

test('P0-7 접근 표: LAN 기기는 읽기만, 분석은 --lan-allow-analyze일 때만, 로컬 전용 경로는 항상 차단', () => {
  const base = { mode: 'lan' as const, lanAllowAnalyze: false, localAuthed: false };
  assert.equal(decideAccess({ ...base, isLocal: true, localAuthed: true, authed: false, access: 'local' }), 'ok');
  assert.equal(decideAccess({ ...base, isLocal: false, authed: false, access: 'read' }), 401);
  assert.equal(decideAccess({ ...base, isLocal: false, authed: true, access: 'read' }), 'ok');
  assert.equal(decideAccess({ ...base, isLocal: false, authed: true, access: 'analyze' }), 403);
  assert.equal(decideAccess({ ...base, isLocal: false, authed: true, access: 'local' }), 403);
  assert.equal(decideAccess({ ...base, lanAllowAnalyze: true, isLocal: false, authed: true, access: 'analyze' }), 'ok');
  assert.equal(decideAccess({ ...base, lanAllowAnalyze: true, isLocal: false, authed: true, access: 'local' }), 403);
  // P0-7-T1 로컬 전용 모드에서 로컬이 아닌 접속은 무조건 거부 (바인딩과 별도의 이중 방어)
  assert.equal(decideAccess({ mode: 'local', lanAllowAnalyze: false, isLocal: false, authed: true, localAuthed: true, access: 'read' }), 403);
  assert.equal(decideAccess({ mode: 'local', lanAllowAnalyze: false, isLocal: true, authed: false, localAuthed: true, access: 'local' }), 'ok');
});

test('P0-7-R12 루프백도 로컬 토큰 세션이 있어야 한다 (같은 PC의 다른 프로세스 차단). 정적 파일만 인증 없이', () => {
  for (const mode of ['local', 'lan'] as const) {
    for (const access of ['read', 'analyze', 'local'] as const) {
      assert.equal(decideAccess({ mode, lanAllowAnalyze: false, isLocal: true, authed: true, localAuthed: false, access }), 401, `${mode} ${access}`);
      assert.equal(decideAccess({ mode, lanAllowAnalyze: false, isLocal: true, authed: false, localAuthed: true, access }), 'ok');
    }
    assert.equal(decideAccess({ mode, lanAllowAnalyze: false, isLocal: true, authed: false, localAuthed: false, access: 'public' }), 'ok');
  }
});

test('P0-7-R12 로컬 토큰은 만료 없이 서버 실행 동안 유효하고, 쿠키에 Max-Age가 없으며, 재발급하면 기존 쿠키가 무효', () => {
  const clock = { t: 1_000_000 };
  const local = new LanAuth({ now: () => clock.t, ttlMs: null });
  const s = local.createSession();
  assert.equal(s.maxAgeSeconds, null);
  assert.equal(sessionCookie(LOCAL_SESSION_COOKIE, s), `floor_local=${s.id}; HttpOnly; SameSite=Strict; Path=/`);
  clock.t += 30 * 24 * 3600_000;
  assert.equal(local.verifyToken(local.token), true);
  assert.equal(local.verifySession(s.id), true);
  local.rotate();
  assert.equal(local.verifySession(s.id), false);
  assert.match(redact(`Cookie: floor_local=${s.id}`), /floor_local=\*\*\*/);
});

test('isLoopback: IPv4·IPv6·매핑 주소', () => {
  for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.ok(isLoopback(a), a);
  for (const a of ['192.168.0.12', '::ffff:192.168.0.12', undefined, '']) assert.equal(isLoopback(a), false, String(a));
});

test('parseCookies: 여러 쿠키, 공백, 잘못된 인코딩', () => {
  assert.deepEqual(parseCookies('a=1; floor_lan=xyz ;b=%ZZ'), { a: '1', floor_lan: 'xyz', b: '%ZZ' });
  assert.deepEqual(parseCookies(undefined), {});
});

test('P1-7-R13, P0-7-R4 로그·오류에서 API 키, LAN 토큰, 쿠키 값, 홈 경로 사용자 이름을 가린다', () => {
  const token = 'AbCdEfGhIjKlMnOpQrStUv';
  const text = [
    'key sk-ant-api03-abcDEF_123-xyz',
    `GET /?t=${token}&x=1`,
    `token ${token}`,
    'cookie floor_lan=sess1234567890abcdef',
    '/Users/alice/Desktop/trading-agent/jobs',
    'C:\\Users\\alice\\AppData',
    '/home/alice/x',
  ].join('\n');
  const out = redact(text, [token, 'sess1234567890abcdef'], '/Users/alice');
  assert.equal(out.includes('sk-ant-api03'), false);
  assert.equal(out.includes(token), false);
  assert.equal(out.includes('sess1234567890abcdef'), false);
  assert.equal(out.includes('alice'), false);
  assert.ok(out.includes('sk-ant-***'));
  assert.ok(out.includes('~/Desktop/trading-agent/jobs'));
});

test('P0-7-R10 교차 사이트 요청은 / 로의 페이지 이동만 허용한다 (Sec-Fetch-Site)', () => {
  // 브라우저가 아닌 클라이언트(헤더 없음)와 같은 출처, 주소창 직접 입력(none)은 허용
  assert.equal(checkFetchSite({}, 'GET', '/reports/all.zip'), true);
  assert.equal(checkFetchSite({ 'sec-fetch-site': 'same-origin' }, 'GET', '/reports/all.zip'), true);
  assert.equal(checkFetchSite({ 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate' }, 'GET', '/diagnostics'), true);
  // 다른 사이트의 <img>, fetch, 페이지 이동은 거부 (같은 사이트의 다른 포트도)
  for (const site of ['cross-site', 'same-site']) {
    assert.equal(checkFetchSite({ 'sec-fetch-site': site, 'sec-fetch-dest': 'image', 'sec-fetch-mode': 'no-cors' }, 'GET', '/reports/all.zip'), false);
    assert.equal(checkFetchSite({ 'sec-fetch-site': site, 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' }, 'GET', '/diagnostics'), false);
    assert.equal(checkFetchSite({ 'sec-fetch-site': site, 'sec-fetch-mode': 'cors' }, 'POST', '/api/analyze'), false);
    // 링크로 첫 화면을 여는 것은 허용 (부작용 없음, LAN 접속 주소 포함)
    assert.equal(checkFetchSite({ 'sec-fetch-site': site, 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' }, 'GET', '/'), true);
    assert.equal(checkFetchSite({ 'sec-fetch-site': site, 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' }, 'GET', '/'), false);
  }
});

test('P0-7.1 LAN 모드는 사설 IPv4에서만: 공인 IP·CGNAT(VPN)·링크 로컬은 제외', () => {
  for (const a of ['10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.0.12']) assert.ok(isPrivateIPv4(a), a);
  for (const a of ['8.8.8.8', '172.32.0.1', '100.64.1.2', '169.254.1.1', '127.0.0.1', '192.169.0.1', 'x']) assert.equal(isPrivateIPv4(a), false, a);
});

test('P0-7.1 연결 수준 검사: 로컬 모드는 루프백으로 들어온 연결만, LAN 모드는 루프백과 고른 사설 주소로 들어온 연결만', () => {
  assert.ok(allowedLocalAddress('127.0.0.1', 'local', []));
  assert.ok(allowedLocalAddress('::ffff:127.0.0.1', 'lan', ['192.168.0.12']));
  assert.ok(allowedLocalAddress('::ffff:192.168.0.12', 'lan', ['192.168.0.12']));
  assert.equal(allowedLocalAddress('100.64.1.2', 'lan', ['192.168.0.12']), false); // VPN 인터페이스
  assert.equal(allowedLocalAddress('192.168.0.12', 'local', ['192.168.0.12']), false);
  assert.equal(allowedLocalAddress(undefined, 'lan', ['192.168.0.12']), false);
});

test('P0-7-R11 LAN 세션 수 상한: 첫 접속을 반복해도 세션 표가 무한히 커지지 않는다 (오래된 것부터 버림)', () => {
  const auth = new LanAuth();
  const first = auth.createSession();
  for (let i = 0; i < MAX_LAN_SESSIONS; i++) auth.createSession();
  assert.equal(auth.verifySession(first.id), false);
  assert.ok(auth.secrets().length <= MAX_LAN_SESSIONS + 1);
});
