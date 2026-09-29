import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBlockedNet, type NetClient } from '../../src/core/data/net.ts';
import { createEngine } from '../../src/core/job/engine.ts';
import { JobStore } from '../../src/core/job/store.ts';
import { createClaudeCliDriver } from '../../src/core/model/claude-cli.ts';
import type { ModelDriver } from '../../src/core/model/driver.ts';
import { ReportStore } from '../../src/core/report/store.ts';
import type { JobEvent } from '../../src/server/jobs.ts';
import { FAKE, FIXTURE, manager } from './server-helpers.ts';
import { replayAcquirer } from '../data-helpers.ts';
import { autoDriver, sampleOutput } from '../job-helpers.ts';

const key = (n = 0) => `test-key-${n}-${'x'.repeat(8)}`;

test('분석 실행: 작업을 만들고 끝까지 돌려 리포트를 남기며, 진행 이벤트를 보낸다', async () => {
  const { m, root } = manager();
  const r = await m.start({ symbol: 'BTC', mode: 'scalp', idempotencyKey: key() });
  assert.equal(r.kind, 'started');
  if (r.kind !== 'started') return;
  const events: JobEvent[] = [];
  const off = m.subscribe(r.jobId, (e) => events.push(e));
  await m.idle();
  off();
  const v = m.view(r.jobId)!;
  assert.equal(v.state, 'COMPLETED');
  assert.equal(v.terminal, true);
  assert.equal(v.reportUrl, `/reports/${r.jobId}`);
  assert.ok(v.panel);
  assert.ok(events.some((e) => e.type === 'call' && e.phase === 'start' && e.role === 'ACE'));
  assert.ok(events.some((e) => e.type === 'job' && e.job.state === 'COMPLETED'));
  assert.equal(events.at(-1)?.type, 'end');
  // 화면용 보기에는 PID·절대 경로가 없다
  const text = JSON.stringify(v);
  assert.equal(text.includes(root), false);
  assert.equal('pids' in v, false);
  assert.equal(new ReportStore(join(root, 'reports')).list().length, 1);
});

test('P0-8-T2 분석 요청을 빠르게 5회 보내면 작업은 1개만 생긴다 (같은 키 → 같은 작업, 다른 키 → 실행 중 응답)', async () => {
  const { m, root } = manager({ driver: () => autoDriver({ TARO: (input) => ({ output: sampleOutput('TARO', input), delayMs: 50 }) }) });
  const same = await Promise.all([1, 2, 3, 4, 5].map(() => m.start({ symbol: 'BTC', mode: 'scalp', idempotencyKey: key(1) })));
  const ids = new Set(same.map((r) => (r.kind === 'started' ? r.jobId : r.kind)));
  assert.equal(ids.size, 1);
  assert.equal(same.filter((r) => r.kind === 'started' && !r.existing).length, 1);
  const other = await Promise.all([2, 3, 4, 5].map((n) => m.start({ symbol: 'BTC', mode: 'scalp', idempotencyKey: key(n + 10) })));
  for (const r of other) {
    assert.equal(r.kind, 'busy'); // P0-8-R5 대기열에 넣지 않는다
    if (r.kind === 'busy') assert.equal(r.runningJobId, [...ids][0]);
  }
  await m.idle();
  assert.equal(new JobStore(join(root, 'jobs')).list().length, 1);
});

test('P0-8-T2 서로 다른 키로 동시에 5회 보내도 (Claude 확인 대기 중) 작업은 1개만 생긴다', async () => {
  const { m, root } = manager({ checkClaude: () => new Promise((r) => setTimeout(() => r({ ok: true }), 30)) });
  const rs = await Promise.all([1, 2, 3, 4, 5].map((n) => m.start({ symbol: 'BTC', mode: 'scalp', idempotencyKey: key(n + 20) })));
  assert.equal(rs.filter((r) => r.kind === 'started').length, 1);
  assert.equal(rs.filter((r) => r.kind === 'busy').length, 4);
  await m.idle();
  assert.equal(new JobStore(join(root, 'jobs')).list().length, 1);
});

test('P0-8-R4 서버를 다시 시작해도 같은 키의 재요청은 새 작업을 만들지 않는다', async () => {
  const first = manager();
  const a = await first.m.start({ symbol: 'BTC', mode: 'scalp', idempotencyKey: key(7) });
  await first.m.idle();
  const second = manager({ root: first.root });
  const b = await second.m.start({ symbol: 'BTC', mode: 'scalp', idempotencyKey: key(7) });
  assert.ok(a.kind === 'started' && b.kind === 'started');
  assert.equal(b.jobId, a.jobId);
  assert.equal(b.existing, true);
  assert.equal(new JobStore(join(first.root, 'jobs')).list().length, 1);
});

test('P1-7-T1, P1-7-R2 위험한 종목 입력·열거형 밖 모드·잘못된 키는 작업을 만들기 전에 거부한다', async () => {
  const { m, root } = manager();
  for (const symbol of ['BTC; del /q *', '../../x', '<script>', 'A'.repeat(33), '', 42, null]) {
    const r = await m.start({ symbol, mode: 'scalp', idempotencyKey: key() });
    assert.equal(r.kind, 'rejected', String(symbol));
    if (r.kind === 'rejected') assert.equal(r.status, 400);
  }
  for (const mode of ['algo', '알고리즘', 'SCALP', '../scalp', undefined]) {
    const r = await m.start({ symbol: 'BTC', mode, idempotencyKey: key() });
    assert.equal(r.kind, 'rejected', String(mode));
  }
  for (const idempotencyKey of [undefined, 'short', 'x'.repeat(65), 'bad key!!!!', 7]) {
    const r = await m.start({ symbol: 'BTC', mode: 'scalp', idempotencyKey });
    assert.equal(r.kind, 'rejected', String(idempotencyKey));
  }
  assert.equal(existsSync(join(root, 'jobs')) ? new JobStore(join(root, 'jobs')).list().length : 0, 0);
});

test('P1-8-R6 Claude 확인 실패는 작업을 만들지 않고 진단 링크를 붙이며, 실행 자리를 돌려준다', async () => {
  let ok = false;
  const { m, root } = manager({ checkClaude: async () => (ok ? { ok: true } : { ok: false, code: 'E-AUTH', detail: '로그인 안 됨' }) });
  const r = await m.start({ symbol: 'BTC', mode: 'scalp', idempotencyKey: key(3) });
  assert.equal(r.kind, 'rejected');
  if (r.kind === 'rejected') {
    assert.equal(r.code, 'E-AUTH');
    assert.equal(r.hint, '/diagnostics');
  }
  assert.equal(existsSync(join(root, 'jobs')) ? new JobStore(join(root, 'jobs')).list().length : 0, 0);
  ok = true;
  const again = await m.start({ symbol: 'BTC', mode: 'scalp', idempotencyKey: key(3) }); // 같은 키로 다시 시도할 수 있다
  assert.equal(again.kind, 'started');
  await m.idle();
});

test('작업 중 실패의 진단 안내: E-CLOCK 작업 보기에 /diagnostics 링크', async () => {
  const { m } = manager({ acquirer: (symbol, mode) => ({ ...replayAcquirer(FIXTURE[mode], { symbol }).acquirer, clockSkewMs: () => 120_000 }) });
  const r = await m.start({ symbol: 'BTC', mode: 'scalp', idempotencyKey: key() });
  await m.idle();
  assert.ok(r.kind === 'started');
  const v = m.view(r.jobId)!;
  assert.equal(v.state, 'FAILED');
  assert.equal(v.error?.code, 'E-CLOCK');
  assert.equal(v.error?.hint, '/diagnostics');
});

test('P0-8-T3 서버 경로에서 취소하면 5초 안에 claude 하위·손자 프로세스가 사라지고 CANCELLED로 확정된다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'floor-cancel-'));
  const pidFile = join(dir, 'pids.json');
  const { m } = manager({
    driver: (engine, job): ModelDriver => {
      const cli = createClaudeCliDriver({ executable: { command: process.execPath, prefixArgs: [FAKE], kind: 'native' }, onSpawn: (pid) => engine.trackPid(job, pid), onExit: (pid) => engine.untrackPid(job, pid) });
      let first = true;
      return {
        kind: cli.kind, countsAsModelCall: true,
        call(req, signal) {
          const hang = first;
          first = false;
          return cli.call({ ...req, input: `${hang ? `#MODE=hang #PIDFILE=${pidFile}` : '#MODE=hang'}\n${req.input}` }, signal);
        },
      };
    },
  });
  const r = await m.start({ symbol: 'BTC', mode: 'scalp', idempotencyKey: key() });
  assert.ok(r.kind === 'started');
  for (let i = 0; i < 100 && !existsSync(pidFile); i++) await new Promise((res) => setTimeout(res, 50));
  const { child, grandchild } = JSON.parse(readFileSync(pidFile, 'utf8')) as { child: number; grandchild: number };
  const t0 = Date.now();
  assert.equal(m.cancel(r.jobId), true);
  await m.idle();
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  while ((alive(child) || alive(grandchild)) && Date.now() - t0 < 5000) await new Promise((res) => setTimeout(res, 50));
  assert.equal(alive(child) || alive(grandchild), false);
  assert.ok(Date.now() - t0 < 5000);
  const v = m.view(r.jobId)!;
  assert.equal(v.state, 'CANCELLED');
  assert.equal(v.error?.code, 'E-CANCELLED');
  assert.equal(m.cancel(r.jobId), false); // 이미 끝난 작업
});

test('P1-8-T1 서버 데모 실행: 외부 요청 0건, 모델 호출 0회, _DEMO 리포트, 다른 종목은 거부', async () => {
  let attempts = 0;
  const blocked = createBlockedNet();
  const counting: NetClient = { kind: 'blocked', get: (url, e) => { attempts++; return blocked.get(url, e); } };
  const realFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => { fetches++; throw new Error('데모에서 fetch 호출'); }) as typeof fetch;
  try {
    const { m, root } = manager({
      demoNet: counting,
      acquirer: () => { throw new Error('데모에서 실전 획득기 사용'); },
      driver: () => { throw new Error('데모에서 실전 드라이버 사용'); },
      checkClaude: async () => { throw new Error('데모에서 Claude 확인'); },
    });
    const r = await m.start({ symbol: 'BTC', mode: 'algorithm', idempotencyKey: key(), demo: true });
    assert.equal(r.kind, 'started');
    await m.idle();
    if (r.kind !== 'started') return;
    const v = m.view(r.jobId)!;
    assert.equal(v.state, 'COMPLETED', v.error?.detail);
    assert.equal(v.demo, true);
    assert.equal(v.usage.modelCallCount, 0);
    assert.equal(new ReportStore(join(root, 'reports')).list('demo').length, 1);
    const wrong = await m.start({ symbol: 'TSLA', mode: 'scalp', idempotencyKey: key(2), demo: true });
    assert.equal(wrong.kind, 'rejected');
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(attempts, 0);
  assert.equal(fetches, 0);
});

test('P1-1-R5, P1-6-R7 서버 시작 정리: web 작업만 INTERRUPTED, 진행 중 /floor 작업은 유지, 임시 파일 정리', async () => {
  const root = mkdtempSync(join(tmpdir(), 'floor-srv-'));
  const store = new JobStore(join(root, 'jobs'));
  const rec = replayAcquirer('btc-scalp');
  const engine = createEngine({ store, now: () => rec.at });
  const web = await engine.createJob({ idempotencyKey: 'k-web-000000', mode: 'scalp', symbolInput: 'BTC', interface: 'web' }, rec.acquirer);
  const floor = await engine.createJob({ idempotencyKey: 'k-floor-0000', mode: 'scalp', symbolInput: 'BTC', interface: 'floor' }, replayAcquirer('btc-scalp').acquirer);
  const { m } = manager({ root });
  const r = m.recover(() => {});
  assert.deepEqual(r.interrupted, [web.record.jobId]);
  assert.equal(store.load(web.record.jobId).state, 'INTERRUPTED');
  assert.equal(store.load(floor.record.jobId).state, 'VALIDATING_DATA');
});

test('idempotency key 조회는 요청마다 작업 기록 전체를 다시 읽지 않는다', async () => {
  const { m } = manager();
  const first = await m.start({ symbol: 'BTC', mode: 'scalp', idempotencyKey: key(40) });
  await m.idle();
  let scans = 0;
  const orig = m.jobs.list.bind(m.jobs);
  m.jobs.list = () => { scans++; return orig(); };
  for (let i = 0; i < 5; i++) {
    const r = await m.start({ symbol: 'BTC', mode: 'scalp', idempotencyKey: key(40) });
    assert.ok(r.kind === 'started' && first.kind === 'started' && r.jobId === first.jobId && r.existing);
  }
  assert.equal(scans, 0);
});
