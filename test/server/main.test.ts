import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine } from '../../src/core/job/engine.ts';
import { JobStore } from '../../src/core/job/store.ts';
import { startServer } from '../../src/server/main.ts';
import { replayAcquirer } from '../data-helpers.ts';

const MAIN = fileURLToPath(new URL('../../src/server/main.ts', import.meta.url));

test('서버 시작: 진행 중 web 작업을 INTERRUPTED로 정리하고 로컬 전용 안내를 출력한다', async () => {
  const home = mkdtempSync(join(tmpdir(), 'floor-home-'));
  const rec = replayAcquirer('btc-scalp');
  const store = new JobStore(join(home, 'jobs'));
  const job = await createEngine({ store, now: () => rec.at }).createJob({ idempotencyKey: 'k-main-000000', mode: 'scalp', symbolInput: 'BTC', interface: 'web' }, rec.acquirer);
  const lines: string[] = [];
  const s = await startServer(['--port', '0'], { FLOOR_HOME: home }, (x) => lines.push(x));
  assert.ok(!('error' in s));
  try {
    assert.equal(store.load(job.record.jobId).state, 'INTERRUPTED');
    const text = lines.join('\n');
    assert.match(text, /중단된 분석 1건/);
    assert.match(text, new RegExp(`http://localhost:${s.port}/\\?demo=1`));
    assert.match(text, /로컬 전용/);
    // 이 PC도 로컬 토큰 주소로 열어야 한다: 토큰은 접속 주소 줄에만 한 번
    assert.equal((await fetch(`http://127.0.0.1:${s.port}/api/status`)).status, 401);
    const token = s.localAuth.token;
    assert.deepEqual(lines.filter((l) => l.includes(token)), [`  이 PC 접속 주소 (서버를 끌 때까지 유효): http://localhost:${s.port}/?t=${token}`]);
    const first = await fetch(s.localUrl(), { redirect: 'manual' });
    assert.equal(first.status, 302);
    const cookie = String(first.headers.get('set-cookie')).split(';')[0]!;
    const r = await fetch(`http://localhost:${s.port}/api/status`, { headers: { Cookie: cookie } });
    assert.equal(r.status, 200);
    assert.equal(((await r.json()) as { mode: string }).mode, 'local');
    // l + Enter: 재발급하면 새 주소를 한 번 표시하고 기존 쿠키는 무효
    s.rotateLocal();
    assert.notEqual(s.localAuth.token, token);
    assert.ok(lines.at(-1)!.endsWith(`/?t=${s.localAuth.token}`));
    assert.equal((await fetch(`http://localhost:${s.port}/api/status`, { headers: { Cookie: cookie } })).status, 401);
    // 같은 포트로 또 시작하면 안내와 함께 실패
    const dup = await startServer(['--port', String(s.port)], { FLOOR_HOME: home }, () => {});
    assert.ok('error' in dup && /이미 사용 중/.test(dup.error));
  } finally {
    await s.shutdown();
  }
  const bad = await startServer(['--lan-allow-analyze'], {}, () => {});
  assert.ok('error' in bad && bad.code === 2);
});

test('--open: 시작한 뒤 로컬 토큰 주소로 브라우저를 연다 (주소를 파일로 남기지 않는다)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'floor-home-'));
  const opened: string[] = [];
  const s = await startServer(['--port', '0', '--open'], { FLOOR_HOME: home }, () => {}, { openBrowser: (u) => opened.push(u) });
  assert.ok(!('error' in s));
  try {
    assert.deepEqual(opened, [s.localUrl()]);
    assert.match(opened[0]!, /^http:\/\/localhost:\d+\/\?t=[A-Za-z0-9_-]{22}$/);
  } finally {
    await s.shutdown();
  }
});

test('P2-7-R2 --doctor: 시작 전에 Node·Claude 점검 요약을 서버 창에 표시하고, 부족해도 서버는 뜬다 (데모·리포트용)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'floor-home-'));
  const lines: string[] = [];
  let calls = 0;
  const doctor = async () => {
    calls++;
    return [
      { id: 'node', label: 'Node.js 버전', status: 'ok' as const, detail: '22.23.2' },
      { id: 'claude-auth', label: '인증 방식', status: 'error' as const, detail: '로그인되어 있지 않음', hint: '터미널에서 claude를 실행해 로그인하세요' },
    ];
  };
  const s = await startServer(['--port', '0', '--doctor'], { FLOOR_HOME: home }, (l) => lines.push(l), { doctor });
  assert.ok(!('error' in s));
  try {
    assert.equal(calls, 1);
    const text = lines.join('\n');
    assert.match(text, /\[오류\] 인증 방식: 로그인되어 있지 않음/);
    assert.match(text, /→ 터미널에서 claude를 실행해 로그인하세요/);
    // 점검 요약이 접속 주소보다 먼저 나온다 (주소가 창 아래쪽에 남게)
    assert.ok(text.indexOf('시작 점검') < text.indexOf('이 PC 접속 주소'));
  } finally {
    await s.shutdown();
  }
  const s2 = await startServer(['--port', '0'], { FLOOR_HOME: home }, () => {}, { doctor });
  assert.ok(!('error' in s2));
  await s2.shutdown();
  assert.equal(calls, 1, '--doctor 없이는 점검하지 않는다');
});

test('P0-7-R1, R4 LAN 시작: 경고와 토큰 주소를 서버 창에 한 번 표시하고, 재발급하면 새 토큰을 표시한다', async () => {
  const home = mkdtempSync(join(tmpdir(), 'floor-home-'));
  const lines: string[] = [];
  const s = await startServer(['--lan', '--port', '0'], { FLOOR_HOME: home }, (x) => lines.push(x), { interfaces: () => ['192.168.0.12', '100.101.102.103', '203.0.113.9'] });
  assert.ok(!('error' in s));
  try {
    assert.equal((s.app.server.address() as { address: string }).address, '0.0.0.0');
    const text = lines.join('\n');
    assert.match(text, /LAN 공유 중 · 암호화되지 않음/);
    // 사설 주소만 접속 주소로 안내하고, VPN(CGNAT)·공인 주소는 받지 않는다고 알린다
    assert.match(text, /http:\/\/192\.168\.0\.12:\d+\/\?t=/);
    assert.equal(/http:\/\/(100\.101|203\.0)/.test(text), false);
    assert.match(text, /접속을 받지 않습니다: 100\.101\.102\.103, 203\.0\.113\.9/);
    const old = s.auth!.token;
    // 토큰은 접속 주소 줄에만 나온다 (주소마다 한 번)
    assert.ok(lines.filter((l) => l.includes(old)).every((l) => l.trim().endsWith(`/?t=${old}`)));
    s.rotate();
    assert.notEqual(s.auth!.token, old);
    assert.match(lines.join('\n'), /재발급/);
  } finally {
    await s.shutdown();
  }
});

test('npm start 진입점: 별도 프로세스로 뜨고 Ctrl+C(SIGINT)로 정상 종료한다', async () => {
  const home = mkdtempSync(join(tmpdir(), 'floor-home-'));
  const child = spawn(process.execPath, [MAIN, '--port', '0'], { env: { PATH: process.env.PATH ?? '', FLOOR_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const exited = new Promise<number | null>((resolve) => child.on('exit', (c) => resolve(c)));
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`시작 안 됨: ${out}`)), 15_000);
      child.stdout.on('data', (d) => {
        out += d;
        const m = /http:\/\/localhost:\d+\/\?t=[A-Za-z0-9_-]+/.exec(out);
        if (m) {
          clearTimeout(t);
          resolve(m[0]);
        }
      });
    });
    const first = await fetch(url, { redirect: 'manual' });
    assert.equal(first.status, 302);
    const r = await fetch(new URL('/', url), { headers: { Cookie: String(first.headers.get('set-cookie')).split(';')[0]! } });
    assert.equal(r.status, 200);
    assert.match(await r.text(), /PIXEL TRADING FLOOR/);
  } finally {
    child.kill('SIGINT');
  }
  assert.equal(await exited, 0);
});

test('P0-7-T8 사설 네트워크 주소가 없으면 LAN 모드를 시작하지 않는다', async () => {
  const r = await startServer(['--lan', '--port', '0'], {}, () => {}, { interfaces: () => ['100.64.0.5', '8.8.8.8'] });
  assert.ok('error' in r);
  assert.match(r.error, /사설 네트워크 주소.*찾지 못해/);
});
