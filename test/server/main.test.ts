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
    const r = await fetch(`http://127.0.0.1:${s.port}/api/status`);
    assert.equal(r.status, 200);
    assert.equal(((await r.json()) as { mode: string }).mode, 'local');
    // 같은 포트로 또 시작하면 안내와 함께 실패
    const dup = await startServer(['--port', String(s.port)], { FLOOR_HOME: home }, () => {});
    assert.ok('error' in dup && /이미 사용 중/.test(dup.error));
  } finally {
    await s.shutdown();
  }
  const bad = await startServer(['--lan-allow-analyze'], {}, () => {});
  assert.ok('error' in bad && bad.code === 2);
});

test('P0-7-R1, R4 LAN 시작: 경고와 토큰 주소를 서버 창에 한 번 표시하고, 재발급하면 새 토큰을 표시한다', async () => {
  const home = mkdtempSync(join(tmpdir(), 'floor-home-'));
  const lines: string[] = [];
  const s = await startServer(['--lan', '--port', '0'], { FLOOR_HOME: home }, (x) => lines.push(x));
  assert.ok(!('error' in s));
  try {
    assert.equal((s.app.server.address() as { address: string }).address, '0.0.0.0');
    const text = lines.join('\n');
    assert.match(text, /LAN 공유 중 · 암호화되지 않음/);
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
  const port = await new Promise<number>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`시작 안 됨: ${out}`)), 15_000);
    child.stdout.on('data', (d) => {
      out += d;
      const m = /http:\/\/localhost:(\d+)/.exec(out);
      if (m) {
        clearTimeout(t);
        resolve(Number(m[1]));
      }
    });
  });
  const r = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /PIXEL TRADING FLOOR/);
  const code = await new Promise<number | null>((resolve) => {
    child.on('exit', (c) => resolve(c));
    child.kill('SIGINT');
  });
  assert.equal(code, 0);
});
