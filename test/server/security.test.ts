import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedHosts, checkHost, checkOrigin, decideAccess, isLoopback, LAN_TOKEN_TTL_MS, LanAuth, parseCookies, RateLimiter, redact,
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
  assert.ok(s.maxAgeSeconds > 0 && s.maxAgeSeconds <= LAN_TOKEN_TTL_MS / 1000);
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
  const base = { mode: 'lan' as const, lanAllowAnalyze: false };
  assert.equal(decideAccess({ ...base, isLocal: true, authed: false, access: 'local' }), 'ok');
  assert.equal(decideAccess({ ...base, isLocal: false, authed: false, access: 'read' }), 401);
  assert.equal(decideAccess({ ...base, isLocal: false, authed: true, access: 'read' }), 'ok');
  assert.equal(decideAccess({ ...base, isLocal: false, authed: true, access: 'analyze' }), 403);
  assert.equal(decideAccess({ ...base, isLocal: false, authed: true, access: 'local' }), 403);
  assert.equal(decideAccess({ ...base, lanAllowAnalyze: true, isLocal: false, authed: true, access: 'analyze' }), 'ok');
  assert.equal(decideAccess({ ...base, lanAllowAnalyze: true, isLocal: false, authed: true, access: 'local' }), 403);
  // P0-7-T1 로컬 전용 모드에서 로컬이 아닌 접속은 무조건 거부 (바인딩과 별도의 이중 방어)
  assert.equal(decideAccess({ mode: 'local', lanAllowAnalyze: false, isLocal: false, authed: true, access: 'read' }), 403);
  assert.equal(decideAccess({ mode: 'local', lanAllowAnalyze: false, isLocal: true, authed: false, access: 'local' }), 'ok');
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
