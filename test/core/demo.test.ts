import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBlockedNet, type NetClient } from '../../src/core/data/net.ts';
import { demoAcquirer, demoClock, demoDriver, demoModes, demoPositions, DemoUnavailableError, loadDemo, positionDemos, type DemoScenario } from '../../src/core/demo.ts';
import { createEngine, type EngineOptions } from '../../src/core/job/engine.ts';
import { panelView } from '../../src/core/rules/display.ts';
import { runJob } from '../../src/core/job/runner.ts';
import { JobStore } from '../../src/core/job/store.ts';
import type { Report } from '../../src/core/report/report.ts';
import { ReportStore, reportSaver } from '../../src/core/report/store.ts';
import type { Mode } from '../../src/core/schema/types.ts';

async function runDemo(s: DemoScenario, net: NetClient = createBlockedNet(), extra: Pick<EngineOptions, 'positions' | 'demoPositions'> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'floor-demo-'));
  const now = demoClock(s);
  const engine = createEngine({ store: new JobStore(join(root, 'jobs')), now, ...extra });
  const job = await engine.createJob({ idempotencyKey: 'demo', mode: s.mode, symbolInput: s.symbol, interface: 'web', demo: true }, demoAcquirer(s, net));
  assert.ok(job.snapshot, job.record.error?.detail);
  const reports = new ReportStore(join(root, 'reports'));
  await runJob(engine, job, demoDriver(s, job.snapshot.snapshotId), new AbortController().signal, { save: reportSaver(reports, { claudeCliVersion: 'none' }, now) });
  return { job, reports };
}

test('P1-8-T1 데모 전체 실행 중 외부 요청 0건이고 모델 호출 0회, 리포트는 demo: true', async () => {
  const realFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => { fetches++; throw new Error('데모에서 fetch 호출'); }) as typeof fetch;
  let attempts = 0;
  const blocked = createBlockedNet();
  const counting: NetClient = { kind: 'blocked', get: (url, e) => { attempts++; return blocked.get(url, e); } };
  try {
    for (const mode of demoModes()) {
      const s = loadDemo(mode);
      const { job, reports } = await runDemo(s, counting);
      const r = job.record;
      assert.equal(r.state, 'COMPLETED', `${mode}: ${r.error?.detail}`);
      assert.equal(r.usage.modelCallCount, 0); // P0-1-R4
      assert.equal(r.demo, true);
      assert.notEqual(job.snapshot!.dataQuality.status, 'INSUFFICIENT_DATA', job.snapshot!.dataQuality.warnings.join('; '));
      assert.ok(job.snapshot!.derived.currentBar, '미완성 봉이 fixture에서 복원된다');
      const rep = JSON.parse(readFileSync(r.report!.json, 'utf8')) as Report;
      assert.equal(rep.demo, true);
      assert.match(r.report!.json, /_DEMO\.json$/);
      assert.equal(rep.versions.models.ACE, 'demo-fixture');
      assert.equal(reports.list('demo').length, 1);
      assert.equal(reports.list().length, 0);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(fetches, 0);
  assert.equal(attempts, 0);
});

test('데모 스캘핑 재생 결과는 녹화된 작업의 판정과 같다 (ACE 관망 · 강세 전망)', async () => {
  const { job } = await runDemo(loadDemo('scalp'));
  const d = job.record.finalDecision!;
  assert.equal(d.action, 'NO_TRADE');
  assert.equal(d.bias, 'BULLISH');
  assert.equal(d.ruleEngine.verdict, 'PASS');
  assert.equal(d.finalDecisionMaker, 'ACE');
});

test('P1-8-T2 데모 ACE 응답의 손절가를 진입가 위로 바꾸면 데모 결과도 V-DIR-LONG으로 강등된다', async () => {
  const s = loadDemo('scalp');
  const long = structuredClone(s.responses.BLITZ![0]) as { action: string; entry: { min: number; max: number }; stopLoss: number };
  assert.equal(long.action, 'ENTER_LONG');
  long.stopLoss = long.entry.max * 1.01;
  const { job } = await runDemo({ ...s, responses: { ...s.responses, ACE: [long] } });
  const d = job.record.finalDecision!;
  assert.equal(job.record.state, 'COMPLETED');
  assert.equal(d.action, 'NO_TRADE');
  assert.ok(d.ruleEngine.violations.some((v) => v.code === 'V-DIR-LONG'), JSON.stringify(d.ruleEngine));
});

test('데모가 없는 모드는 알 수 있는 오류를 낸다', () => {
  const missing = (['algorithm', 'scalp', 'forced_direction'] as Mode[]).filter((m) => !demoModes().includes(m));
  for (const m of missing) assert.throws(() => loadDemo(m), /데모가 없습니다/);
});

test('데모 알고리즘 재생 결과는 녹화된 실전 작업(Phase 5 스모크)과 같다: 13명 전 과정, 토론 2라운드, PM 기각', async () => {
  const { job } = await runDemo(loadDemo('algorithm'));
  const r = job.record;
  assert.equal(r.state, 'COMPLETED');
  assert.equal(r.debate.roundCount, 2);
  assert.equal(r.debate.stopReason, 'MAX_ROUNDS');
  assert.equal(r.usage.calls.length, 13);
  assert.equal(r.finalDecision?.pmDecision, 'REJECT');
  assert.equal(r.finalDecision?.action, 'NO_TRADE');
  assert.deepEqual(r.finalDecision?.reasonCodes, ['PM_REJECTED']);
  assert.equal(r.finalDecision?.ruleEngine.verdict, 'PASS');
});

test('P1-10-T2 데모 fixture는 근거 검사 경고가 0건이다 (모든 데모 모드)', async () => {
  for (const mode of demoModes()) {
    const { job } = await runDemo(loadDemo(mode));
    assert.equal(job.record.state, 'COMPLETED', mode);
    assert.deepEqual(job.record.evidenceAudit, [], `${mode}: ${JSON.stringify(job.record.evidenceAudit)}`);
  }
});

test('P1-8-T1 강제 방향 데모: 신호 없이도 롱/숏 중 하나를 고르고 unforcedAction을 남긴다', async () => {
  const { job } = await runDemo(loadDemo('forced_direction'));
  const d = job.record.finalDecision!;
  assert.equal(job.record.state, 'COMPLETED');
  assert.equal(d.forcedDirection, true);
  assert.equal(d.finalDecisionMaker, 'ACE');
  assert.ok(d.action === 'ENTER_LONG' || d.action === 'ENTER_SHORT', String(d.action));
  assert.ok(d.unforcedAction !== null);
  assert.equal(d.ruleEngine.verdict, 'PASS', JSON.stringify(d.ruleEngine.violations));
  assert.equal(job.record.usage.calls.length, 5);
});

// ── P2-8 포지션 데모 ──

const POSITION_DEMOS: Record<string, { action: string; headline: string; codes?: string[] }> = {
  'btc-hold': { action: 'HOLD', headline: '유지' },
  'btc-reduce': { action: 'REDUCE', headline: '일부 청산 검토 (50%)' },
  'btc-exit': { action: 'EXIT', headline: '전량 청산 검토', codes: ['LIQUIDATION_NEAR'] },
};

test('P2-8-T1 포지션 데모 3종: 외부 요청 0건·모델 호출 0회·근거 경고 0건, 실제 포지션 북은 읽지 않는다', async () => {
  assert.deepEqual(positionDemos().map((p) => p.name).sort(), Object.keys(POSITION_DEMOS).sort());
  let attempts = 0;
  const blocked = createBlockedNet();
  const counting: NetClient = { kind: 'blocked', get: (url, e) => { attempts++; return blocked.get(url, e); } };
  for (const p of positionDemos()) {
    const want = POSITION_DEMOS[p.name]!;
    let realReads = 0;
    const s = loadDemo(p.mode, undefined, p.name);
    const { job } = await runDemo(s, counting, { positions: () => { realReads++; throw new Error('데모가 실제 북을 읽음'); }, demoPositions: () => demoPositions(s) });
    const r = job.record;
    const d = r.finalDecision!;
    assert.equal(r.state, 'COMPLETED', `${p.name}: ${r.error?.detail}`);
    assert.equal(r.usage.modelCallCount, 0);
    assert.equal(realReads, 0, p.name);
    assert.deepEqual(r.evidenceAudit, [], `${p.name}: ${JSON.stringify(r.evidenceAudit)}`);
    assert.equal(d.action, want.action, `${p.name}: ${JSON.stringify(d.ruleEngine)}`);
    assert.equal(d.positionRef, r.positionContext?.position?.id);
    const v = panelView(d, new Date(d.decidedAt), r.positionContext ?? null);
    assert.equal(v.headline, want.headline);
    assert.notEqual(v.tone, 'long', p.name);
    assert.ok(v.position?.startsWith('사용한 포지션: '), p.name);
    for (const c of want.codes ?? []) assert.ok(d.reasonCodes.includes(c), `${p.name}: ${d.reasonCodes.join(',')}`);
  }
  assert.equal(attempts, 0);
  assert.throws(() => loadDemo('algorithm', undefined, 'btc-hold'), DemoUnavailableError);
  assert.throws(() => loadDemo('scalp', undefined, 'nope'), DemoUnavailableError);
  assert.equal(demoPositions(loadDemo('scalp')), null, '포지션 없는 데모는 컨텍스트를 만들지 않는다');
});
