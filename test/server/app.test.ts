import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DiagResult } from '../../src/core/diag.ts';
import { createApp, CSP, LIMITS, type AppOptions } from '../../src/server/app.ts';
import { BoardService } from '../../src/server/board.ts';
import { LAN_TOKEN_TTL_MS, LanAuth, lanIPv4Addresses } from '../../src/server/security.ts';
import { replayNet } from '../data-helpers.ts';
import { autoDriver, sampleOutput } from '../job-helpers.ts';
import { manager } from './server-helpers.ts';
import { readZip } from './zip-reader.ts';

const LAN_IP = '192.168.77.20';

interface Res { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer; text: string; json: any }

type Harness = Awaited<ReturnType<typeof start>>;

async function start(over: Partial<AppOptions> & { managerOpts?: Parameters<typeof manager>[0] } = {}) {
  const { m, root } = manager(over.managerOpts ?? {});
  const logs: string[] = [];
  const localAuth = over.localAuth ?? new LanAuth({ ttlMs: null });
  const app = createApp({
    manager: m, mode: 'local', port: 0, auth: null, localAuth, lanAddrs: [LAN_IP],
    clientIp: (req) => (req.headers['x-test-ip'] as string | undefined) ?? req.socket.remoteAddress,
    diagnostics: async (claudeTest): Promise<DiagResult> => ({
      ok: true, clockSkewMs: 0,
      checks: [
        { id: 'port', label: '포트', status: 'ok', detail: '이 서버가 사용 중' },
        { id: 'server-mode', label: '서버 모드', status: 'ok', detail: '로컬 전용 <b>' },
        { id: 'dir:reports/', label: 'reports/ 쓰기', status: 'ok', detail: `${homedir()}/x/reports` },
        ...(claudeTest ? [{ id: 'claude-test', label: 'Claude 시험 호출', status: 'ok' as const, detail: '성공' }] : []),
      ],
    }),
    log: (s) => logs.push(s),
    ...over,
  });
  const port = await app.listen();
  const host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;
  let localCookie = '';
  /** cookie를 주지 않으면 이 PC의 로컬 토큰 세션 쿠키를 보낸다. ''이면 쿠키 없이 (같은 PC의 다른 프로세스 흉내) */
  const req = (path: string, o: { method?: string; host?: string; origin?: string | null; ip?: string; cookie?: string; body?: unknown; type?: string; headers?: Record<string, string> } = {}): Promise<Res> =>
    new Promise((resolve, reject) => {
      const method = o.method ?? (o.body !== undefined ? 'POST' : 'GET');
      const headers: Record<string, string> = { Host: o.host ?? host, ...o.headers };
      if (o.ip) headers['x-test-ip'] = o.ip;
      const cookie = o.cookie ?? localCookie;
      if (cookie) headers.Cookie = cookie;
      const originHeader = o.origin === undefined ? (method === 'GET' ? null : origin) : o.origin;
      if (originHeader) headers.Origin = originHeader;
      let payload: string | undefined;
      if (o.body !== undefined) {
        payload = typeof o.body === 'string' ? o.body : JSON.stringify(o.body);
        headers['Content-Type'] = o.type ?? 'application/json';
      }
      const r = httpRequest({ host: '127.0.0.1', port, path, method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          const text = body.toString('utf8');
          let json: any = null;
          try { json = JSON.parse(text); } catch { /* HTML */ }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body, text, json });
        });
      });
      r.on('error', reject);
      r.end(payload);
    });
  const first = await req(`/?t=${localAuth.token}`);
  assert.equal(first.status, 302);
  localCookie = String(first.headers['set-cookie']).split(';')[0]!;
  return { app, m, root, port, host, origin, req, logs, localAuth, localCookie };
}

let n = 0;
const analyzeBody = (over: Record<string, unknown> = {}) => ({ symbol: 'BTC', mode: 'scalp', idempotencyKey: `app-key-${++n}-xxxxxxxx`, ...over });

/** SSE를 끝(end 이벤트)까지 읽는다 */
function readSse(port: number, host: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number; events: { event: string; data: any }[] }> {
  return new Promise((resolve, reject) => {
    const r = httpRequest({ host: '127.0.0.1', port, path, headers: { Host: host, ...headers } }, (res) => {
      let buf = '';
      const events: { event: string; data: any }[] = [];
      res.setEncoding('utf8');
      res.on('data', (d: string) => {
        buf += d;
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (ev && data) events.push({ event: ev, data: JSON.parse(data) });
        }
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, events }));
    });
    r.on('error', reject);
    r.end();
  });
}

async function lan(over: Partial<AppOptions> = {}, clock = { t: Date.now() }) {
  const auth = new LanAuth({ now: () => clock.t });
  const h = await start({ mode: 'lan', auth, now: () => clock.t, ...over });
  // LAN Host로 접속한 다른 기기 흉내
  const lanHost = `${LAN_IP}:${h.port}`;
  const remote = (path: string, o: Parameters<Harness['req']>[1] = {}) => h.req(path, { host: lanHost, ip: LAN_IP, origin: o.method === 'POST' || o.body !== undefined ? `http://${lanHost}` : null, ...o });
  const login = async () => {
    const r = await remote(`/?t=${auth.token}`);
    assert.equal(r.status, 302);
    return String(r.headers['set-cookie']).split(';')[0]!;
  };
  return { ...h, auth, clock, remote, login, lanHost };
}

test('P0-7-T1 기본 실행은 127.0.0.1에만 바인딩하고, 로컬이 아닌 접속은 거부한다', async () => {
  const h = await start();
  try {
    assert.equal((h.app.server.address() as { address: string }).address, '127.0.0.1');
    assert.equal((await h.req('/api/status')).status, 200);
    assert.equal((await h.req('/api/status', { ip: LAN_IP })).status, 403); // 이중 방어
    // 이 PC의 LAN 주소로는 연결 자체가 안 된다
    for (const addr of lanIPv4Addresses().slice(0, 1)) {
      const refused = await new Promise<boolean>((resolve) => {
        const s = connect({ host: addr, port: h.port });
        s.once('connect', () => { s.destroy(); resolve(false); });
        s.once('error', () => resolve(true));
      });
      assert.equal(refused, true, addr);
    }
  } finally {
    await h.app.close();
  }
});

test('P0-7-T3 Host: evil.example 요청은 로컬·LAN 두 모드 모두 거부된다', async () => {
  const h = await start();
  const l = await lan();
  try {
    for (const x of [h, l]) {
      assert.equal((await x.req('/', { host: 'evil.example' })).status, 403);
      assert.equal((await x.req('/api/status', { host: `evil.example:${x.port}` })).status, 403);
      assert.equal((await x.req('/api/status', { host: `localhost:${x.port}` })).status, 200);
    }
    assert.equal((await h.req('/api/status', { host: `${LAN_IP}:${h.port}` })).status, 403); // 로컬 모드는 LAN 주소 Host도 거부
  } finally {
    await h.app.close();
    await l.app.close();
  }
});

test('P0-7-T2, P0-7-R3 LAN: 토큰 없음·잘못된 토큰은 401, 토큰 → HttpOnly·SameSite=Strict 쿠키와 토큰 없는 주소로 이동, 만료되면 401', async () => {
  const clock = { t: Date.now() };
  const l = await lan({}, clock);
  try {
    assert.equal((await l.remote('/')).status, 401);
    assert.equal((await l.remote('/api/status')).status, 401);
    assert.equal((await l.remote('/?t=wrong-token-value')).status, 401);
    const first = await l.remote(`/?t=${l.auth.token}&demo=1`);
    assert.equal(first.status, 302);
    assert.equal(first.headers.location, '/?demo=1');
    const setCookie = String(first.headers['set-cookie']);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(';')[0]!;
    assert.equal((await l.remote('/', { cookie })).status, 200);
    const st = await l.remote('/api/status', { cookie });
    assert.equal(st.json.client.readOnly, true);
    assert.equal(st.json.lan.warning, 'LAN 공유 중 · 암호화되지 않음');
    // P0-7-R4: 토큰은 응답·로그에 나오지 않는다
    assert.equal(st.text.includes(l.auth.token), false);
    assert.equal(l.logs.some((x) => x.includes(l.auth.token) || x.includes(cookie.split('=')[1]!)), false);
    assert.ok(l.logs.some((x) => x.includes('?t=***')));
    clock.t += LAN_TOKEN_TTL_MS + 1000;
    assert.equal((await l.remote('/', { cookie })).status, 401);
    assert.equal((await l.remote(`/?t=${l.auth.token}`)).status, 401);
    // 서버 PC(로컬)는 토큰 없이 쓴다
    assert.equal((await l.req('/api/status')).status, 200);
  } finally {
    await l.app.close();
  }
});

test('P0-7-T6 토큰을 재발급하면 기존 쿠키로 보낸 요청이 401이 된다 (재발급은 서버 PC에서만)', async () => {
  let rotated = 0;
  const l = await lan({ onRotate: () => rotated++ });
  try {
    const cookie = await l.login();
    assert.equal((await l.remote('/api/status', { cookie })).status, 200);
    assert.equal((await l.remote('/api/lan/rotate', { cookie, method: 'POST' })).status, 403);
    const r = await l.req('/api/lan/rotate', { method: 'POST' });
    assert.equal(r.status, 200);
    assert.equal(r.text.includes(l.auth.token), false);
    assert.equal(rotated, 1);
    assert.equal((await l.remote('/api/status', { cookie })).status, 401);
    const again = await l.login();
    assert.equal((await l.remote('/api/status', { cookie: again })).status, 200);
  } finally {
    await l.app.close();
  }
});

test('P0-7-T4 LAN 기기에서 all.zip, project.zip, 분석 실행·취소, 진단이 차단되고 화면·리포트는 열린다', async () => {
  const l = await lan({ enableProjectZip: true });
  try {
    const cookie = await l.login();
    assert.equal((await l.remote('/api/analyze', { cookie, body: analyzeBody() })).status, 403);
    assert.equal((await l.remote('/reports/all.zip', { cookie, method: 'POST' })).status, 403);
    assert.equal((await l.remote('/project.zip', { cookie })).status, 403);
    assert.equal((await l.remote('/project.zip', { cookie, method: 'POST' })).status, 403);
    assert.equal((await l.remote('/api/project-zip/files', { cookie })).status, 403);
    assert.equal((await l.remote('/diagnostics', { cookie })).status, 403);
    assert.equal((await l.remote('/diagnostics', { cookie, method: 'POST' })).status, 403);
    assert.equal((await l.remote('/api/diagnostics', { cookie, method: 'POST' })).status, 403);
    assert.equal((await l.remote('/reports', { cookie })).status, 200);
    assert.equal((await l.remote('/api/reports', { cookie })).status, 200);
    assert.equal((await l.remote('/web/floor.js', { cookie })).status, 200);
    // 서버 PC에서는 분석 실행 가능
    const ok = await l.req('/api/analyze', { body: analyzeBody() });
    assert.equal(ok.status, 202);
    const id = ok.json.jobId;
    assert.equal((await l.remote(`/api/jobs/${id}/cancel`, { cookie, method: 'POST' })).status, 403);
    assert.equal((await l.remote(`/api/jobs/${id}`, { cookie })).status, 200);
    await l.m.idle();
  } finally {
    await l.app.close();
  }
});

test('P0-7-R9 --lan-allow-analyze를 켜면 LAN 기기도 분석을 실행할 수 있다 (로컬 전용 경로는 여전히 차단)', async () => {
  const l = await lan({ lanAllowAnalyze: true });
  try {
    const cookie = await l.login();
    const r = await l.remote('/api/analyze', { cookie, body: analyzeBody() });
    assert.equal(r.status, 202);
    assert.equal((await l.remote('/reports/all.zip', { cookie, method: 'POST' })).status, 403);
    await l.m.idle();
  } finally {
    await l.app.close();
  }
});

test('P0-7-T5 경로 이동 요청은 거부되고 파일 내용이 나가지 않는다', async () => {
  const h = await start();
  try {
    for (const p of [
      '/reports/..%2f..%2fpackage.json', '/reports/..%2F..%2Fpackage.json', '/reports/../../package.json', '/reports/%2e%2e/%2e%2e/package.json',
      '/web/..%2f..%2f..%2fpackage.json', '/web/../../package.json', '/web/%2e%2e%2fserver%2fapp.ts', '/api/jobs/..%2f..%2fjobs', '/reports/x.json',
    ]) {
      const r = await h.req(p);
      assert.ok(r.status === 404 || r.status === 400, `${p} → ${r.status}`);
      assert.equal(r.text.includes('"devDependencies"'), false, p);
    }
  } finally {
    await h.app.close();
  }
});

test('P0-7-R6 상태를 바꾸는 요청은 Origin이 허용 출처일 때만, 본문은 JSON만', async () => {
  const h = await start();
  try {
    assert.equal((await h.req('/api/analyze', { body: analyzeBody(), origin: null })).status, 403);
    assert.equal((await h.req('/api/analyze', { body: analyzeBody(), origin: 'http://evil.example' })).status, 403);
    assert.equal((await h.req('/api/analyze', { body: 'symbol=BTC', type: 'application/x-www-form-urlencoded' })).status, 415);
    assert.equal((await h.req('/api/analyze', { body: '[1]' })).status, 400);
    assert.equal((await h.req('/api/analyze', { body: { ...analyzeBody(), symbol: 'BTC; del /q *' } })).status, 400); // P1-7-T1
    const ok = await h.req('/api/analyze', { body: analyzeBody(), origin: `http://localhost:${h.port}`, ip: '::1' }); // 위 세 요청이 분석 실행 횟수를 썼다
    assert.equal(ok.status, 202);
    await h.m.idle();
  } finally {
    await h.app.close();
  }
});

test('P0-7-R7 분석 실행은 IP당 분당 3회까지, 넘으면 429', async () => {
  const h = await start({ managerOpts: { driver: () => autoDriver({ TARO: (input) => ({ output: sampleOutput('TARO', input), delayMs: 100 }) }) } });
  try {
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await h.req('/api/analyze', { body: analyzeBody() })).status);
    assert.deepEqual(codes, [202, 409, 409, 429]);
    const busy = await h.req('/api/analyze', { body: analyzeBody(), ip: '::ffff:127.0.0.1' }); // 다른 주소는 따로 센다
    assert.equal(busy.status, 409);
    assert.equal(busy.json.error, 'E-BUSY');
    assert.equal(busy.json.message, '실행 중인 분석이 있습니다');
    assert.ok(busy.json.running.jobId);
    await h.m.idle();
  } finally {
    await h.app.close();
  }
});

test('P1-7-R12 모든 응답에 콘텐츠 보안 정책, 표에 없는 경로는 404', async () => {
  const h = await start();
  try {
    for (const p of ['/', '/api/status', '/reports', '/nope', '/diagnostics']) {
      const r = await h.req(p);
      assert.equal(r.headers['content-security-policy'], CSP, p);
      assert.equal(r.headers['x-content-type-options'], 'nosniff');
    }
    assert.equal((await h.req('/nope')).status, 404);
    assert.equal((await h.req('/api/status', { method: 'POST' })).status, 404);
    assert.equal((await h.req('/api/analyze')).status, 404); // GET 없음
    assert.equal(CSP, "default-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
    const index = await h.req('/');
    assert.equal(/<script>|<script [^>]*>[^<]/.test(index.text), false); // 인라인 스크립트 없음
  } finally {
    await h.app.close();
  }
});

test('SSE: 분석 진행 이벤트(작업 보기·역할 호출)를 끝까지 보내고 end로 닫는다. 끝난 작업은 바로 닫는다', async () => {
  const h = await start({ managerOpts: { demoDelayMs: 20 } });
  try {
    const r = await h.req('/api/analyze', { body: analyzeBody({ mode: 'algorithm', demo: true, idempotencyKey: 'sse-demo-key-1' }) });
    assert.equal(r.status, 202);
    const id = r.json.jobId;
    const s = await readSse(h.port, h.host, `/api/jobs/${id}/events`, { Cookie: h.localCookie });
    assert.equal(s.status, 200);
    const states = s.events.filter((e) => e.event === 'job').map((e) => e.data.job.state);
    assert.ok(states.includes('ANALYZING') && states.includes('DEBATING'), states.join(','));
    assert.equal(states.at(-1), 'COMPLETED');
    assert.ok(s.events.some((e) => e.event === 'call' && e.data.role === 'PM'));
    assert.equal(s.events.at(-1)?.event, 'end');
    const after = await readSse(h.port, h.host, `/api/jobs/${id}/events`, { Cookie: h.localCookie });
    assert.deepEqual(after.events.map((e) => e.event), ['job', 'end']);
    assert.equal((await h.req('/api/jobs/00000000-0000-4000-8000-000000000000/events')).status, 404);
    // 같은 키로 다시 보내면 새 작업 없이 기존 작업 (P0-8-R4)
    const again = await h.req('/api/analyze', { body: analyzeBody({ mode: 'algorithm', demo: true, idempotencyKey: 'sse-demo-key-1' }) });
    assert.equal(again.status, 200);
    assert.equal(again.json.jobId, id);
    assert.equal(again.json.existing, true);
    const snap = await h.req(`/api/jobs/${id}/snapshot`);
    assert.equal(snap.json.snapshotHash, r.json.job?.snapshot?.snapshotHash ?? snap.json.snapshotHash);
  } finally {
    await h.app.close();
  }
});

test('P1-7-T2 리포트 화면에서 모델 출력의 HTML·javascript: 링크가 실행되지 않는다 (이스케이프)', async () => {
  const payload = '<img src=x onerror=alert(1)> [클릭](javascript:alert(1)) <script>alert(2)</script>';
  const h = await start({
    managerOpts: { driver: () => autoDriver({ TARO: (input) => ({ output: { ...(sampleOutput('TARO', input) as object), summary: payload, narrative: payload } }) }) },
  });
  try {
    const r = await h.req('/api/analyze', { body: analyzeBody() });
    await h.m.idle();
    const id = r.json.jobId;
    const v = await h.req(`/api/jobs/${id}`);
    assert.equal(v.json.state, 'COMPLETED', JSON.stringify(v.json.error));
    const page = await h.req(`/reports/${id}`);
    assert.equal(page.status, 200);
    assert.ok(page.text.includes('img src=x onerror=alert(1)')); // 글자로는 보인다
    assert.equal(page.text.includes('<img'), false);
    assert.equal(page.text.includes('<script>alert'), false);
    assert.equal(/href="javascript:/i.test(page.text), false);
    const md = await h.req(`/reports/${id}.md`);
    assert.match(String(md.headers['content-disposition']), /attachment/);
    assert.match(String(md.headers['content-type']), /text\/markdown/);
  } finally {
    await h.app.close();
  }
});

test('P1-7-R15 all.zip은 분석 탭 리포트만 담고, 상한을 넘으면 만들지 않는다. 목록 API에 파일 경로가 없다', async () => {
  const h = await start();
  try {
    await h.req('/api/analyze', { body: analyzeBody() });
    await h.m.idle();
    await h.req('/api/analyze', { body: analyzeBody({ demo: true }) });
    await h.m.idle();
    assert.equal((await h.req('/reports/all.zip')).status, 404, 'GET으로는 만들지 않는다');
    const listPage = await h.req('/reports');
    assert.ok(listPage.text.includes('<form method="post" action="/reports/all.zip">'));
    const z = await h.req('/reports/all.zip', { method: 'POST' });
    assert.equal(z.status, 200);
    const names = readZip(z.body).map((e) => e.name);
    assert.equal(names.length, 2);
    assert.ok(names.every((x) => x.startsWith('reports/') && !x.includes('_DEMO')), names.join(','));
    const list = await h.req('/api/reports');
    assert.equal(list.json.reports.length, 1);
    assert.equal('file' in list.json.reports[0], false);
    assert.equal(list.text.includes(h.root), false);
    assert.equal((await h.req('/api/reports?tab=demo')).json.reports.length, 1);
    assert.equal((await h.req('/api/reports?tab=../x')).status, 400);
    const html = await h.req('/reports?tab=demo');
    assert.ok(html.text.includes('DEMO · 실제 데이터 아님')); // P1-8-R4
  } finally {
    await h.app.close();
  }
  const small = await start({ allZipMaxBytes: 10 });
  try {
    await small.req('/api/analyze', { body: analyzeBody() });
    await small.m.idle();
    const r = await small.req('/reports/all.zip', { method: 'POST' });
    assert.equal(r.status, 413);
  } finally {
    await small.app.close();
  }
});

test('P1-7-T5, P1-7-R14 project.zip: 기본 비활성, 켜면 목록 확인 뒤 같은 목록일 때만 만들고 인증 정보는 빠진다', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'floor-proj-'));
  for (const [rel, text] of [['package.json', '{}'], ['start-floor.command', '#!/bin/bash\n'], ['src/a.ts', 'x'], ['.claude/settings.local.json', 'secret'], ['.credentials.json', 'secret'], ['.env', 'K=1']] as const) {
    mkdirSync(join(projectRoot, rel, '..'), { recursive: true });
    writeFileSync(join(projectRoot, rel), text);
  }
  const off = await start({ projectRoot });
  try {
    assert.equal((await off.req('/project.zip')).status, 404);
    assert.equal((await off.req('/api/project-zip/files')).status, 404);
  } finally {
    await off.app.close();
  }
  const h = await start({ projectRoot, enableProjectZip: true });
  try {
    const preview = await h.req('/project.zip');
    assert.equal(preview.status, 200);
    assert.match(String(preview.headers['content-type']), /text\/html/);
    assert.ok(preview.text.includes('src/a.ts'));
    assert.equal(preview.text.includes('.credentials'), false);
    const files = await h.req('/api/project-zip/files');
    assert.ok(preview.text.includes(`name="confirm" value="${files.json.listHash}"`));
    const form = (confirm: string) => h.req('/project.zip', { body: `confirm=${confirm}`, type: 'application/x-www-form-urlencoded' });
    assert.equal((await h.req(`/project.zip?confirm=${files.json.listHash}`)).headers['content-type']?.includes('text/html'), true, 'GET은 목록만');
    assert.equal((await form('0000000000000000')).status, 409);
    assert.equal((await h.req('/project.zip', { body: { confirm: files.json.listHash } })).status, 415);
    const z = await form(files.json.listHash);
    assert.equal(z.status, 200);
    const entries = readZip(z.body);
    const names = entries.map((e) => e.name);
    assert.deepEqual(names.sort(), ['pixel-trading-floor/package.json', 'pixel-trading-floor/src/a.ts', 'pixel-trading-floor/start-floor.command']);
    assert.equal(entries.find((e) => e.name.endsWith('start-floor.command'))?.mode, 0o755, 'P2-7-R1 macOS 시작 파일은 실행 권한 유지');
    assert.equal(names.some((x) => x.includes('.claude/') || x.includes('credentials') || x.includes('.env')), false);
  } finally {
    await h.app.close();
  }
});

test('/diagnostics: GET은 실행 버튼만, 실행은 POST로만, 결과는 이스케이프, 시험 호출은 버튼(POST)으로만', async () => {
  let runs = 0;
  const h = await start();
  const counted = await start({ diagnostics: async () => { runs++; return { ok: true, clockSkewMs: 0, checks: [] }; } });
  try {
    const page = await counted.req('/diagnostics');
    assert.equal(page.status, 200);
    assert.ok(page.text.includes('<form method="post" action="/diagnostics">'));
    assert.equal(runs, 0, 'GET으로는 진단을 돌리지 않는다');
    assert.equal((await counted.req('/api/diagnostics')).status, 404);
    assert.equal(runs, 0);
    const d = await h.req('/diagnostics', { method: 'POST' });
    assert.equal(d.status, 200);
    assert.ok(d.text.includes('포트'));
    assert.ok(d.text.includes('로컬 전용 &lt;b&gt;'));
    assert.ok(d.text.includes('~/x/reports')); // 홈 경로의 사용자 이름을 가린다
    assert.ok(d.text.includes('action="/diagnostics/claude-test"'));
    assert.equal(d.text.includes('Claude 시험 호출</td>'), false);
    const t = await h.req('/diagnostics/claude-test', { method: 'POST' });
    assert.equal(t.status, 200);
    assert.ok(t.text.includes('Claude 시험 호출</td>'));
    assert.equal((await h.req('/diagnostics/claude-test', { method: 'POST', origin: 'http://evil.example' })).status, 403);
    assert.equal((await h.req('/api/diagnostics', { method: 'POST' })).json.ok, true);
    assert.equal((await h.req('/diagnostics', { method: 'POST', origin: 'http://evil.example' })).status, 403);
  } finally {
    await h.app.close();
    await counted.app.close();
  }
});

test('P1-8-R6, P1-7-R13 Claude 확인 실패 응답에 진단 링크, 오류 응답에 홈 경로·키가 없다', async () => {
  const h = await start({ managerOpts: { checkClaude: async () => ({ ok: false, code: 'E-CLI-MISSING', detail: `not found in ${process.env.HOME}/.local/bin sk-ant-api03-SECRET` }) } });
  try {
    const r = await h.req('/api/analyze', { body: analyzeBody() });
    assert.equal(r.status, 503);
    assert.equal(r.json.error, 'E-CLI-MISSING');
    assert.equal(r.json.hint, '/diagnostics');
    assert.equal(r.text.includes('sk-ant-api03-SECRET'), false);
    if (process.env.HOME) assert.equal(r.text.includes(process.env.HOME), false);
  } finally {
    await h.app.close();
  }
});

const CROSS_IMG = { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'no-cors', 'Sec-Fetch-Dest': 'image' };
const CROSS_NAV = { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' };

test('P0-7-T7, P0-7-R10 다른 사이트가 사용자 브라우저로 보낸 요청은 부작용 전에 거부되고, 사용자의 요청 한도를 쓰지 못한다', async () => {
  let diagRuns = 0;
  const h = await start({ enableProjectZip: true, diagnostics: async () => { diagRuns++; return { ok: true, clockSkewMs: 0, checks: [] }; } });
  try {
    for (const p of ['/reports/all.zip', '/diagnostics', '/api/diagnostics', '/project.zip', '/api/reports', '/api/status']) {
      const r = await h.req(p, { headers: CROSS_IMG });
      assert.equal(r.status, 403, p);
      assert.equal(r.json?.error ?? 'E-CROSS-SITE', 'E-CROSS-SITE');
    }
    assert.equal((await h.req('/diagnostics', { headers: CROSS_NAV })).status, 403); // 새 창으로 여는 것도
    assert.equal((await h.req('/api/analyze', { body: analyzeBody(), headers: { 'Sec-Fetch-Site': 'same-site', 'Sec-Fetch-Mode': 'cors' } })).status, 403); // 다른 포트의 로컬 페이지
    assert.equal(diagRuns, 0);
    // 링크로 첫 화면을 여는 것은 된다
    assert.equal((await h.req('/', { headers: CROSS_NAV })).status, 200);
    // 교차 사이트 요청을 한도 이상 보내도 사용자의 요청은 막히지 않는다
    for (let i = 0; i < 130; i++) await h.req('/favicon.ico', { headers: CROSS_IMG });
    assert.equal((await h.req('/api/status', { headers: { 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
    assert.equal((await h.req('/api/status')).status, 200);
  } finally {
    await h.app.close();
  }
});

test('응답을 다른 사이트가 끌어다 쓰지 못하게 CORP·COOP same-origin을 붙인다', async () => {
  const h = await start();
  try {
    for (const p of ['/', '/api/status', '/reports', '/web/floor.js']) {
      const r = await h.req(p);
      assert.equal(r.headers['cross-origin-resource-policy'], 'same-origin', p);
      assert.equal(r.headers['cross-origin-opener-policy'], 'same-origin', p);
    }
  } finally {
    await h.app.close();
  }
});

test('P0-7-R11 SSE 연결 수 상한: 한 주소가 진행 연결을 무한히 열 수 없다', async () => {
  const h = await start({ managerOpts: { driver: () => autoDriver({ TARO: () => ({ hang: true }) }) } });
  const open: import('node:http').ClientRequest[] = [];
  let id = '';
  try {
    const r = await h.req('/api/analyze', { body: analyzeBody() });
    id = r.json.jobId;
    const connect = () => new Promise<number>((resolve, reject) => {
      const q = httpRequest({ host: '127.0.0.1', port: h.port, path: `/api/jobs/${id}/events`, headers: { Host: h.host, Cookie: h.localCookie } }, (res) => resolve(res.statusCode ?? 0));
      q.on('error', reject);
      q.end();
      open.push(q);
    });
    for (let i = 0; i < LIMITS.ssePerIp; i++) assert.equal(await connect(), 200);
    assert.equal(await connect(), 429);
    // 연결을 닫으면 다시 열 수 있다
    open.shift()!.destroy();
    await new Promise((res) => setTimeout(res, 50));
    assert.equal(await connect(), 200);
  } finally {
    for (const q of open) q.destroy();
    h.m.cancel(id); // 실패해도 멈춘 작업을 끝낸다
    await h.m.idle();
    await h.app.close();
  }
});

test('P0-7-T8 LAN 모드는 0.0.0.0에 바인딩해도 고른 사설 주소·루프백이 아닌 인터페이스로 들어온 연결을 끊는다', async () => {
  const l = await lan(); // lanAddrs = [LAN_IP(가짜)] → 이 PC의 실제 주소는 목록 밖
  try {
    assert.equal((await l.req('/api/status')).status, 200); // 루프백
    for (const addr of lanIPv4Addresses().slice(0, 1)) {
      const outcome = await new Promise<string>((resolve) => {
        const q = httpRequest({ host: addr, port: l.port, path: '/api/status', headers: { Host: `${addr}:${l.port}` } }, (res) => resolve(`HTTP ${res.statusCode}`));
        q.on('error', (e) => resolve((e as NodeJS.ErrnoException).code ?? 'error'));
        q.end();
      });
      assert.match(outcome, /ECONNRESET|EPIPE|socket hang up|ECONNREFUSED/, addr);
    }
  } finally {
    await l.app.close();
  }
});

test('P0-1-R6 /api/status는 모드별 계획 호출 수 범위와 최악 호출 수를 준다', async () => {
  const h = await start();
  try {
    const s = (await h.req('/api/status')).json;
    assert.deepEqual(Object.keys(s.plans).sort(), ['algorithm', 'forced_direction', 'scalp']);
    assert.equal(s.plans.algorithm.min, 11);
    assert.equal(s.plans.algorithm.max, 13);
    assert.ok(s.plans.algorithm.maxModelCalls >= 13);
    assert.ok(s.plans.scalp.maxModelCalls >= 5);
  } finally {
    await h.app.close();
  }
});

test('P1-8-T1, P0-7.4 /api/board: 시세는 LAN 인증 기기도 보고(read), 데모 전광판은 외부 요청 0건', async () => {
  const { net } = replayNet('btc-algorithm');
  const l = await lan({ board: new BoardService({ net }) });
  try {
    const cookie = await l.login();
    assert.equal((await l.remote('/api/board?symbol=BTC')).status, 401);
    const demo = await l.remote('/api/board?symbol=BTC&demo=1', { cookie });
    assert.equal(demo.status, 200);
    assert.equal(demo.json.demo, true);
    assert.equal(net.requests.length, 0);
    const live = await l.remote('/api/board?symbol=BTC', { cookie });
    assert.equal(live.status, 200);
    assert.equal(live.json.instrumentId, 'CRYPTO:BTC');
    assert.ok(net.requests.length > 0);
    const bad = await l.req('/api/board?symbol=%3Cscript%3E');
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error, 'E-INPUT');
  } finally {
    await l.app.close();
  }
});

test('P0-7-T9 로컬 토큰: 토큰 없는 루프백(같은 PC의 다른 프로세스)·잘못된 토큰은 401, 토큰 → 쿠키 → 200, 재발급하면 기존 쿠키 401', async () => {
  const h = await start();
  try {
    // 쿠키 없는 루프백 요청: API·페이지·SSE·전광판 모두 401, 정적 파일만 열린다
    for (const p of ['/', '/api/status', '/reports', '/api/board?symbol=BTC&demo=1', '/diagnostics']) {
      const r = await h.req(p, { cookie: '' });
      assert.equal(r.status, 401, p);
      assert.equal(r.text.includes(h.localAuth.token), false);
    }
    const page = await h.req('/reports', { cookie: '' });
    assert.match(page.text, /서버 창에 표시된 주소로 다시 여세요/);
    assert.equal((await h.req('/api/analyze', { cookie: '', body: analyzeBody() })).status, 401);
    assert.equal((await h.req('/web/floor.css', { cookie: '' })).status, 200);
    // 잘못된 토큰 (다른 사이트가 /?t= 링크를 만들어도 토큰을 모르면 쿠키가 생기지 않는다)
    const bad = await h.req('/?t=AAAAAAAAAAAAAAAAAAAAAA', { cookie: '', headers: CROSS_NAV });
    assert.equal(bad.status, 401);
    assert.equal(bad.headers['set-cookie'], undefined);
    // 토큰 → HttpOnly·SameSite=Strict 세션 쿠키(Max-Age 없음) → 토큰 없는 주소로 이동
    const ok = await h.req(`/?t=${h.localAuth.token}&demo=1`, { cookie: '' });
    assert.equal(ok.status, 302);
    assert.equal(ok.headers.location, '/?demo=1');
    const set = String(ok.headers['set-cookie']);
    assert.match(set, /^floor_local=[^;]+; HttpOnly; SameSite=Strict; Path=\/$/);
    const cookie = set.split(';')[0]!;
    assert.equal((await h.req('/api/status', { cookie })).status, 200);
    // 재발급: 기존 쿠키 전부 무효
    h.localAuth.rotate();
    assert.equal((await h.req('/api/status', { cookie })).status, 401);
    assert.equal((await h.req('/api/status')).status, 401);
    // 로그에 토큰이 남지 않는다
    assert.equal(h.logs.some((l) => l.includes(h.localAuth.token)), false);
  } finally {
    await h.app.close();
  }
});

test('P0-7-T9 LAN 모드: 서버 PC도 로컬 토큰이 필요하고, LAN 토큰 재발급이 서버 PC 브라우저를 로그아웃시키지 않는다', async () => {
  const l = await lan();
  try {
    assert.equal((await l.req('/api/status', { cookie: '' })).status, 401, '루프백이라서 인증을 건너뛰지 않는다');
    // LAN 토큰으로는 서버 PC 세션이 생기지 않는다 (루프백은 로컬 토큰만)
    assert.equal((await l.req(`/?t=${l.auth.token}`, { cookie: '' })).status, 401);
    const lanCookie = await l.login();
    l.auth.rotate();
    assert.equal((await l.remote('/api/status', { cookie: lanCookie })).status, 401);
    assert.equal((await l.req('/api/status')).status, 200);
    // 다른 기기가 로컬 쿠키를 들고 와도 통하지 않는다
    assert.equal((await l.remote('/api/status', { cookie: l.localCookie })).status, 401);
  } finally {
    await l.app.close();
  }
});

test('P0-7-T10 Sec-Fetch-Site를 보내지 않는 구형 브라우저의 다른 사이트발 요청으로도 진단 실행·ZIP 생성이 일어나지 않는다', async () => {
  let diagRuns = 0;
  const h = await start({ enableProjectZip: true, diagnostics: async () => { diagRuns++; return { ok: true, clockSkewMs: 0, checks: [] }; } });
  try {
    // <img>·링크(GET): 부작용 있는 GET 경로가 없다
    for (const p of ['/reports/all.zip', '/api/diagnostics', '/diagnostics', '/project.zip?confirm=x']) {
      const r = await h.req(p);
      assert.ok(r.status === 404 || !/zip/.test(String(r.headers['content-type'])), p);
    }
    // 폼 POST(쿠키가 실렸다고 가정해도): Origin이 다른 사이트라 거부된다 (P0-7-R6)
    const evil = 'http://evil.example';
    for (const p of ['/reports/all.zip', '/diagnostics', '/diagnostics/claude-test', '/api/diagnostics']) {
      assert.equal((await h.req(p, { method: 'POST', origin: evil })).status, 403, p);
    }
    assert.equal((await h.req('/project.zip', { body: 'confirm=x', type: 'application/x-www-form-urlencoded', origin: evil })).status, 403);
    // Origin을 빼도 거부된다
    assert.equal((await h.req('/diagnostics', { method: 'POST', origin: null })).status, 403);
    // SameSite=Strict라 실제로는 쿠키도 실리지 않는다: 쿠키 없이 보내면 401
    assert.equal((await h.req('/diagnostics', { method: 'POST', origin: evil, cookie: '' })).status, 401);
    assert.equal(diagRuns, 0);
  } finally {
    await h.app.close();
  }
});

test('P0-7-R6 폼 POST가 실제 Origin을 싣도록 Referrer-Policy는 same-origin (no-referrer면 브라우저가 Origin: null을 보낸다)', async () => {
  const h = await start();
  try {
    const r = await h.req('/diagnostics');
    assert.equal(r.headers['referrer-policy'], 'same-origin');
    // no-referrer 페이지의 폼 제출처럼 Origin: null이면 거부된다 (정책이 바뀌면 진단·ZIP 버튼이 모두 403이 됨)
    assert.equal((await h.req('/diagnostics', { method: 'POST', origin: 'null' })).status, 403);
    assert.equal((await h.req('/diagnostics', { method: 'POST' })).status, 200);
  } finally {
    await h.app.close();
  }
});

const btcPerp = (over: Record<string, unknown> = {}) => ({
  symbol: 'BTC', marketType: 'perpetual', side: 'LONG', avgEntryPrice: 80000, quantity: 0.1, leverage: 10, marginMode: 'isolated',
  liquidationPrice: 72500, stopLoss: 78000, targets: [90000], note: '메모', ...over,
});

test('P2-1-T5 LAN 세션은 GET/PUT /api/positions에 403, 서버 PC는 읽고 쓴다', async () => {
  const l = await lan();
  try {
    const cookie = await l.login();
    assert.equal((await l.remote('/api/positions', { cookie })).status, 403);
    assert.equal((await l.remote('/api/positions', { cookie, method: 'PUT', body: { positions: [] } })).status, 403);
    assert.equal((await l.req('/api/positions')).status, 200);
    assert.equal((await l.req('/api/positions', { method: 'PUT', body: { positions: [btcPerp()] } })).status, 200);
  } finally {
    await l.app.close();
  }
});

test('P2-1-R1·R2 PUT /api/positions: 종목 글자를 instrumentId로 저장, 오류는 필드별 400이고 저장하지 않음', async () => {
  const h = await start();
  try {
    const empty = await h.req('/api/positions');
    assert.deepEqual([empty.json.status, empty.json.book.positions], ['missing', []]);

    const ok = await h.req('/api/positions', { method: 'PUT', body: { account: { equity: { USDT: 1000 } }, positions: [btcPerp()] } });
    assert.equal(ok.status, 200);
    const p = ok.json.book.positions[0];
    assert.deepEqual([p.instrumentId, 'symbol' in p, ok.json.names['CRYPTO:BTC']], ['CRYPTO:BTC', false, '비트코인 (BTC)']);
    const saved = readFileSync(join(h.root, '.floor', 'positions.json'), 'utf8');

    const bad = await h.req('/api/positions', { method: 'PUT', body: { positions: [btcPerp({ quantity: -1 }), btcPerp({ symbol: '없는종목', marketType: 'spot' })] } });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.json.errors.map((e: { path: string }) => e.path).sort(), ['$.positions[0].quantity', '$.positions[1].symbol']);
    assert.equal(readFileSync(join(h.root, '.floor', 'positions.json'), 'utf8'), saved);

    // 교차 출처·잘못된 형식은 부작용 전에 거부
    assert.equal((await h.req('/api/positions', { method: 'PUT', body: { positions: [] }, origin: 'http://evil.example' })).status, 403);
    assert.equal((await h.req('/api/positions', { method: 'PUT', body: 'positions=', type: 'application/x-www-form-urlencoded' })).status, 415);
    assert.equal(readFileSync(join(h.root, '.floor', 'positions.json'), 'utf8'), saved);
  } finally {
    await h.app.close();
  }
});

test('P2-1-R8·R10 화면 분석은 시작 때 포지션 북을 고정하고, 다른 시장 보유는 한 줄로 보인다', async () => {
  const h = await start();
  try {
    await h.req('/api/positions', { method: 'PUT', body: { positions: [btcPerp()] } });
    const r = await h.req('/api/analyze', { body: analyzeBody({ mode: 'algorithm' }) }); // BTC 현물 분석
    assert.equal(r.status, 202);
    await h.m.idle();
    const v = (await h.req(`/api/jobs/${r.json.jobId}`)).json;
    assert.deepEqual(v.positionNotes, ['다른 시장 보유 있음: 비트코인 (BTC) 무기한']);
    assert.equal('positionContext' in v, false);
    const rec = h.m.jobs.load(r.json.jobId);
    assert.equal(rec.positionContext?.position, null);
    assert.equal(rec.positionContext?.otherMarkets.length, 1);
  } finally {
    await h.app.close();
  }
});

// ── P2-5 마스킹 (Phase 14) ──

const EQUITY = 98765.43; // 손실 한도 1% = 987.65
const spotBook = { account: { equity: { USDT: EQUITY } }, positions: [btcPerp({ marketType: 'spot', leverage: null, marginMode: null, liquidationPrice: null, quantity: 0.123457 })] };

test('P2-5-T3 LAN 응답(작업·SSE·리포트)은 금액·수량·총 자산을 가리고, 서버 PC는 원본을 본다', async () => {
  const l = await lan();
  try {
    assert.equal((await l.req('/api/positions', { method: 'PUT', body: spotBook })).status, 200);
    const r = await l.req('/api/analyze', { body: analyzeBody({ mode: 'scalp' }) }); // 무기한 작업 · 현물 보유 → 진입 수량 제안
    await l.m.idle();
    const id = r.json.jobId;
    const local = (await l.req(`/api/jobs/${id}`)).json;
    assert.equal(local.finalDecision.action, 'ENTER_LONG');
    const q = local.finalDecision.sizing.suggestedQuantity;
    assert.equal(typeof q, 'number');
    assert.equal(local.finalDecision.sizing.riskBudget, 987.65);

    const cookie = await l.login();
    const secrets = [String(EQUITY), '987.65', '0.123457', `제안 수량 ${q} `];
    const clean = (label: string, text: string) => {
      for (const s of secrets) assert.ok(!text.includes(s), `${label}: ${s}`);
      assert.ok(text.includes('[masked]'), label);
    };
    const remote = await l.remote(`/api/jobs/${id}`, { cookie });
    clean('job', remote.text);
    assert.equal(remote.json.finalDecision.sizing.suggestedQuantity, '[masked]');
    assert.ok(remote.json.panel.notes.some((n: string) => n.startsWith('제안 수량 [masked] (')));
    const sse = await readSse(l.port, l.lanHost, `/api/jobs/${id}/events`, { Cookie: cookie, 'x-test-ip': LAN_IP });
    clean('sse', JSON.stringify(sse.events));
    for (const ext of ['.json', '.md', '']) clean(`report${ext}`, (await l.remote(`/reports/${id}${ext}`, { cookie })).text);
    // 서버 PC는 저장된 원본 그대로
    assert.ok((await l.req(`/reports/${id}.json`)).text.includes(String(EQUITY)));
    // P2-5-T2: 서버 로그(LAN 요청 줄 포함)에 포지션 값이 없다
    assert.ok(l.logs.length > 0);
    for (const s of [String(EQUITY), '0.123457', '메모', '80000']) assert.ok(!l.logs.join('\n').includes(s), `log: ${s}`);
  } finally {
    await l.app.close();
  }
});

test('P2-5-T3 all.zip은 가린 JSON·Markdown을 담고, project.zip은 .floor/를 담지 않는다', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'floor-proj-'));
  for (const [rel, text] of [['package.json', '{}'], ['.floor/positions.json', JSON.stringify(spotBook)], ['.floor/positions.json.bak', 'x'], ['src/.floor/x.json', 'x']] as const) {
    mkdirSync(join(projectRoot, rel, '..'), { recursive: true });
    writeFileSync(join(projectRoot, rel), text);
  }
  const h = await start({ projectRoot, enableProjectZip: true });
  try {
    await h.req('/api/positions', { method: 'PUT', body: spotBook });
    await h.req('/api/analyze', { body: analyzeBody({ mode: 'scalp' }) });
    await h.m.idle();
    const entries = readZip((await h.req('/reports/all.zip', { method: 'POST' })).body);
    assert.deepEqual(entries.map((e) => e.name.split('.').at(-1)).sort(), ['json', 'md']);
    for (const e of entries) {
      const text = e.data.toString('utf8');
      for (const s of [String(EQUITY), '987.65', '0.123457']) assert.ok(!text.includes(s), `${e.name}: ${s}`);
      assert.ok(text.includes('[masked]'), e.name);
    }
    const files = await h.req('/api/project-zip/files');
    const z = await h.req('/project.zip', { body: `confirm=${files.json.listHash}`, type: 'application/x-www-form-urlencoded' });
    const names = readZip(z.body).map((e) => e.name);
    assert.deepEqual(names, ['pixel-trading-floor/package.json']);
  } finally {
    await h.app.close();
  }
});
