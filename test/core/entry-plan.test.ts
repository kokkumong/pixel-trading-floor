// P3 신규 진입 명세 1·3·4장: 스키마 v4, 시나리오·분할 규칙, 파생 값, 이전 버전 읽기 (Phase 17)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { maskDecision, MASK } from '../../src/core/position/mask.ts';
import { panelView } from '../../src/core/rules/display.ts';
import { applyRules } from '../../src/core/rules/engine.ts';
import { renderMarkdown } from '../../src/core/report/markdown.ts';
import { buildReport } from '../../src/core/report/report.ts';
import type { Report } from '../../src/core/report/report.ts';
import { checkProposal, diffProposalFields, type ProposalOutput, type Scenario } from '../../src/core/schema/proposal.ts';
import { proposal, proposalCtx, proposalOutput, ruleCtx } from '../helpers.ts';
import { bookRead, held, runWithBook } from '../position-helpers.ts';

/** 현재가 100, ATR 0.8 기준 롱 눌림 시나리오: 구간 98~99, 손절 97.5, 목표 102·104, 10배 (손익비 2) */
function scn(over: Partial<Scenario> = {}): Scenario {
  return {
    role: 'ALTERNATE', side: 'LONG',
    trigger: { kind: 'PULLBACK', level: 98.5, timeframe: '1h', confirmation: '1시간봉 종가가 98.5 위에서 마감' },
    entry: { type: 'zone', min: 98, max: 99 },
    stopLoss: 97.5, targets: [102, 104], leverage: 10, tranches: null,
    invalidationConditions: ['1시간봉 종가 97.5 이탈'], recheckAfterMinutes: 60,
    evidenceRefs: ['derived:rsi14'], rationale: '지지 구간 재확인',
    ...over,
  };
}
/** 숏 이탈 시나리오: 99 이탈 뒤 98~98.8 진입, 손절 99.6, 목표 96 */
const shortScn = (over: Partial<Scenario> = {}) => scn({
  side: 'SHORT', trigger: { kind: 'BREAKOUT', level: 99, timeframe: '1h', confirmation: '1시간봉 종가 99 이탈' },
  entry: { type: 'zone', min: 98, max: 98.8 }, stopLoss: 99.6, targets: [96], ...over,
});
const noTrade = (over: Partial<ProposalOutput> = {}) => proposal({
  action: 'NO_TRADE', bias: 'NEUTRAL', entry: { type: 'market', min: null, max: null }, stopLoss: null, targets: [], leverage: null, ...over,
});
const flat = (equity: number | null = 1000) => held({}, { none: true, equity });
const run = (p: ReturnType<typeof proposal>, over: Parameters<typeof ruleCtx>[1] = {}, mode: Parameters<typeof ruleCtx>[0] = 'algorithm') =>
  applyRules(p, ruleCtx(mode, { positionContext: flat(), ...over }));
const dropCodes = (o: ReturnType<typeof applyRules>) => o.entryPlan?.dropped.map((d) => d.codes) ?? [];

test('P3-1 스키마 v4: scenarios·tranches를 읽고 proposal/4로 확정한다. 필드가 없으면 빈 값으로 채운다', () => {
  const r = checkProposal({ ...proposalOutput(), scenarios: [scn()], tranches: null }, proposalCtx('algorithm'));
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  assert.equal(r.proposal.schemaVersion, 'proposal/4');
  assert.equal(r.proposal.scenarios[0]?.trigger.level, 98.5);

  const { scenarios: _s, tranches: _t, ...v3 } = proposalOutput();
  const old = checkProposal(v3, proposalCtx('algorithm'));
  assert.ok(old.ok);
  assert.deepEqual([old.proposal.scenarios, old.proposal.tranches], [[], null]);

  const bad = checkProposal({ ...proposalOutput(), scenarios: [{ ...scn(), stopLoss: -1 }] }, proposalCtx('algorithm'));
  assert.ok(!bad.ok && bad.errors[0]?.path === '$.scenarios[0].stopLoss');
  // PM이 시나리오를 바꾸면 변경 필드에 잡힌다 (P3-5-R3)
  assert.deepEqual(diffProposalFields(proposalOutput(), proposalOutput({ scenarios: [scn()] })), ['scenarios']);
});

test('P3-1-T1 롱 PULLBACK 시나리오가 level ≥ 현재가이거나 구간 밖이면 V-SCN-TRIGGER로 그 시나리오만 제거되고 판정은 그대로다', () => {
  const above = scn({ trigger: { ...scn().trigger, level: 100.5 }, entry: { type: 'zone', min: 100.2, max: 100.8 }, stopLoss: 99.5, targets: [103] });
  const outside = scn({ trigger: { ...scn().trigger, level: 99.5 } });
  const o = run(proposal({ scenarios: [above, scn()] }));
  assert.deepEqual([o.action, o.verdict, o.violations], ['ENTER_LONG', 'PASS', []]);
  assert.deepEqual(dropCodes(o), [['V-SCN-TRIGGER']]);
  assert.equal(o.entryPlan?.scenarios.length, 1);
  assert.deepEqual(dropCodes(run(proposal({ scenarios: [outside] }))), [['V-SCN-TRIGGER']]);
  // 돌파: 롱은 level > 현재가이고 level ≤ entry.min, 숏 이탈은 level < 현재가이고 entry.max ≤ level
  const breakout = scn({ trigger: { ...scn().trigger, kind: 'BREAKOUT', level: 101 }, entry: { type: 'zone', min: 101, max: 101.5 }, stopLoss: 100.2, targets: [104.5] });
  assert.deepEqual(dropCodes(run(proposal({ scenarios: [breakout, shortScn()] }))), []);
  assert.deepEqual(dropCodes(run(proposal({ scenarios: [{ ...breakout, trigger: { ...breakout.trigger, level: 99.9 } }] }))), [['V-SCN-TRIGGER']]);
});

test('P3-1-T2 forced_direction·포지션 보유·INSUFFICIENT_DATA는 entryPlan이 없다', () => {
  const forced = applyRules(proposal({ unforcedAction: 'NO_TRADE', scenarios: [scn()] }), ruleCtx('forced_direction', { positionContext: flat() }));
  assert.equal(forced.entryPlan, null);
  const keep = proposal({ action: 'HOLD', positionRef: held().position!.id, entry: { type: 'market', min: null, max: null }, stopLoss: null, targets: [], leverage: 5, scenarios: [scn()] });
  assert.equal(applyRules(keep, ruleCtx('algorithm', { positionContext: held() })).entryPlan, null);
  assert.equal(run(proposal({ scenarios: [scn()] }), { dataQuality: 'INSUFFICIENT_DATA' }).entryPlan, null);
});

test('P3-1-T3 ENTER_LONG 판정에서 지금 진입안과 구간이 50% 넘게 겹치는 롱 시나리오는 V-SCN-DUP으로 제거된다', () => {
  const main = { entry: { type: 'zone' as const, min: 98, max: 100 }, stopLoss: 97.8 };
  const dup = scn({ entry: { type: 'zone', min: 98, max: 99.2 } });
  const deep = scn({ trigger: { ...scn().trigger, level: 96.8 }, entry: { type: 'zone', min: 96.5, max: 97 }, stopLoss: 95.5, targets: [100, 102] });
  const o = run(proposal({ ...main, scenarios: [dup, deep] }));
  assert.equal(o.action, 'ENTER_LONG');
  assert.deepEqual(o.entryPlan?.dropped, [{ index: 0, role: 'ALTERNATE', side: 'LONG', codes: ['V-SCN-DUP'] }]);
  assert.equal(o.entryPlan?.scenarios[0]?.entry.max, 97);
  // NO_TRADE 판정에는 지금 진입안이 없으므로 겹침 검사를 하지 않는다
  assert.deepEqual(dropCodes(run(noTrade({ scenarios: [dup] }))), []);
});

test('P3-1-T4 bias가 BULLISH인데 PRIMARY가 숏이면 V-SCN-BIAS로 제거된다. NEUTRAL이면 통과한다', () => {
  const primaryShort = shortScn({ role: 'PRIMARY' });
  assert.deepEqual(dropCodes(run(noTrade({ bias: 'BULLISH', scenarios: [primaryShort] }))), [['V-SCN-BIAS']]);
  assert.deepEqual(dropCodes(run(noTrade({ bias: 'NEUTRAL', scenarios: [primaryShort] }))), []);
  // ALTERNATE는 반대 방향 가능
  assert.deepEqual(dropCodes(run(noTrade({ bias: 'BULLISH', scenarios: [shortScn()] }))), []);
});

test('P3-4-T1 시나리오 규칙 위반(SHAPE·DIR·DISTANCE·LEVERAGE)은 action을 바꾸지 않는다', () => {
  const cases: [Scenario, string][] = [
    [scn({ entry: { type: 'market', min: 98, max: 99 } }), 'V-SCN-SHAPE'],
    [scn({ entry: { type: 'limit', min: 98, max: 99 } }), 'V-SCN-SHAPE'],
    [scn({ targets: [] }), 'V-SCN-SHAPE'],
    [scn({ recheckAfterMinutes: 121 }), 'V-SCN-SHAPE'],
    [scn({ stopLoss: 98.5 }), 'V-SCN-DIR'],
    [scn({ targets: [98.5] }), 'V-SCN-DIR'],
    [shortScn({ stopLoss: 98.5 }), 'V-SCN-DIR'],
    [scn({ trigger: { ...scn().trigger, level: 95.5 }, entry: { type: 'zone', min: 95, max: 96 }, stopLoss: 94.5 }), 'V-SCN-DISTANCE'],
    [scn({ leverage: 21 }), 'V-SCN-LEVERAGE'],
    [scn({ leverage: null }), 'V-SCN-LEVERAGE'],
    [scn({ leverage: 20, stopLoss: 96 }), 'V-SCN-LEVERAGE'], // 손절 거리 3.03% > 증거금 소진 거리 4.5%의 0.5배
  ];
  for (const [s, code] of cases) {
    const o = run(proposal({ scenarios: [s] }));
    assert.deepEqual([o.action, o.verdict, dropCodes(o)], ['ENTER_LONG', 'PASS', [[code]]], code);
    assert.ok(o.entryPlan?.warnings.includes('SCN_DROPPED'));
  }
  // 시나리오 3건·PRIMARY 2건은 뒤쪽이 제거된다
  const many = run(noTrade({ scenarios: [scn({ role: 'PRIMARY' }), scn({ role: 'PRIMARY' }), scn()] }));
  assert.deepEqual(many.entryPlan?.dropped.map((d) => [d.index, d.codes]), [[1, ['V-SCN-SHAPE']], [2, ['V-SCN-SHAPE']]]);
  // 현물 숏 시나리오
  const spot = run(noTrade({ marketType: 'spot', scenarios: [shortScn({ leverage: null })] }));
  assert.deepEqual(dropCodes(spot), [['V-SCN-SHAPE']]);
});

test('P3-4-T2 제거된 시나리오는 entryPlan.dropped에 사유 코드와 함께 기록된다 (P3-2-R2: 강등된 NO_TRADE도 재검사한 것만 남는다)', () => {
  // 지금 진입안은 V-DIR-LONG 위반으로 강등, 시나리오 하나는 같은 오류, 하나는 정상
  const o = run(proposal({ stopLoss: 101, scenarios: [scn({ stopLoss: 99.5 }), scn({ role: 'PRIMARY' })] }));
  assert.deepEqual([o.action, o.verdict], ['NO_TRADE', 'DOWNGRADED']);
  assert.deepEqual(o.entryPlan?.dropped, [{ index: 0, role: 'ALTERNATE', side: 'LONG', codes: ['V-SCN-DIR'] }]);
  assert.deepEqual(o.entryPlan?.scenarios.map((s) => s.role), ['PRIMARY']);
  assert.equal(o.entryPlan?.tranchePlan, null);
});

test('P3-4-T3 rewardRisk < 1.5이면 LOW_REWARD_RISK 경고가 붙고 시나리오는 유지된다. 파생 값(손익비·수량·위험 거리)을 저장한다', () => {
  const o = run(noTrade({ scenarios: [scn({ targets: [100, 104] }), scn({ role: 'PRIMARY' })] }));
  const [low, ok] = o.entryPlan!.scenarios;
  assert.deepEqual([low?.rewardRisk, low?.warnings], [0.67, ['LOW_REWARD_RISK']]);
  assert.deepEqual([ok?.rewardRisk, ok?.warnings], [2, []]);
  // 수량: 예산 10 ÷ (99 − 97.5) = 6.666666, 증거금 6.666666 × 99 ÷ 10
  assert.deepEqual([ok?.sizing?.suggestedQuantity, ok?.sizing?.entryPrice, ok?.sizing?.marginRequired], [6.666666, 99, 66]);
  assert.deepEqual([ok?.risk?.basePrice, ok?.risk?.leverage, ok?.risk?.stopDistancePercent], [99, 10, 1.515152]);
});

test('P3-2-R1 모델이 낸 NO_TRADE에 PRIMARY 시나리오가 없으면 NO_WAIT_PLAN 경고 (차단 없음)', () => {
  const none = run(noTrade());
  assert.deepEqual([none.action, none.verdict, none.entryPlan?.warnings], ['NO_TRADE', 'PASS', ['NO_WAIT_PLAN']]);
  assert.deepEqual(run(noTrade({ scenarios: [scn()] })).entryPlan?.warnings, ['NO_WAIT_PLAN']);
  assert.deepEqual(run(noTrade({ scenarios: [scn({ role: 'PRIMARY' })] })).entryPlan?.warnings, []);
  assert.deepEqual(run(proposal()).entryPlan?.warnings, [], 'ENTER_*에는 요구하지 않는다');
});

const zone = { entry: { type: 'zone' as const, min: 96, max: 100 }, stopLoss: 90, targets: [112], leverage: 2 };
/** 지금 진입안(96~100)과 겹치지 않는 롱 돌파 시나리오 */
const breakout = (over: Partial<Scenario> = {}) => scn({
  trigger: { ...scn().trigger, kind: 'BREAKOUT', level: 101 }, entry: { type: 'zone', min: 101, max: 101.5 }, stopLoss: 100.2, targets: [104.5], ...over,
});
const three = [{ price: 100, weight: 0.5 }, { price: 98, weight: 0.3 }, { price: 96, weight: 0.2 }];

test('P3-3-T1 총 자산 1000·한도 1%·zone 100~96 롱·손절 90·3분할 → avgEntry 98.6, tranche 수량 0.581395·0.348837·0.232558, 전부 체결 후 손절 손실 ≤ 10', () => {
  const o = run(proposal({ ...zone, tranches: three }));
  assert.deepEqual([o.action, o.verdict], ['ENTER_LONG', 'PASS']);
  const tp = o.entryPlan!.tranchePlan!;
  assert.equal(tp.avgEntry, 98.6);
  assert.deepEqual(tp.rows.map((r) => r.quantity), [0.581395, 0.348837, 0.232558]);
  assert.deepEqual(tp.rows.map((r) => r.cumulativeQuantity), [0.581395, 0.930232, 1.16279]);
  assert.equal(tp.totalQuantity, 1.16279);
  assert.ok(tp.lossAtStop !== null && tp.lossAtStop <= 10 && tp.lossAtStop > 9.99, String(tp.lossAtStop));
  assert.equal(tp.marginRequired, 57.33); // 1.16279 × 98.6 ÷ 2
  assert.deepEqual([o.sizing?.entryPrice, o.sizing?.suggestedQuantity], [98.6, 1.16279]);
});

test('P3-3-T2 롱에서 가격 오름차순(V-TRANCHE-ORDER)·비중 합 ≠ 1(V-TRANCHE-SUM)·간격 < 0.2×ATR(V-TRANCHE-SPREAD)이면 tranches만 제거되고 단일 진입 수량이 남는다', () => {
  const cases: [{ price: number; weight: number }[], string][] = [
    [[...three].reverse(), 'V-TRANCHE-ORDER'],
    [[{ price: 101, weight: 0.5 }, { price: 98, weight: 0.5 }], 'V-TRANCHE-ORDER'], // 구간 밖
    [[{ price: 100, weight: 0.5 }, { price: 98, weight: 0.4 }], 'V-TRANCHE-SUM'],
    [[{ price: 100, weight: 0.95 }, { price: 98, weight: 0.05 }], 'V-TRANCHE-SUM'],
    [[{ price: 100, weight: 1 }], 'V-TRANCHE-SUM'],
    [[{ price: 100, weight: 0.5 }, { price: 99.9, weight: 0.5 }], 'V-TRANCHE-SPREAD'],
  ];
  for (const [tranches, code] of cases) {
    const o = run(proposal({ ...zone, tranches }));
    assert.deepEqual([o.action, o.verdict, o.entryPlan?.tranchePlan, o.entryPlan?.trancheViolations], ['ENTER_LONG', 'PASS', null, [code]], code);
    assert.ok(o.entryPlan?.warnings.includes('TRANCHE_DROPPED'));
    assert.deepEqual([o.sizing?.entryPrice, o.sizing?.suggestedQuantity], [100, 1], '단일 진입: 예산 10 ÷ (100 − 90)');
  }
  // 시나리오의 분할도 같은 규칙: 분할만 제거되고 시나리오는 남는다
  const s = run(noTrade({ scenarios: [scn({ role: 'PRIMARY', tranches: [{ price: 98, weight: 0.5 }, { price: 99, weight: 0.5 }] })] }));
  assert.deepEqual([s.entryPlan?.scenarios[0]?.trancheViolations, s.entryPlan?.scenarios[0]?.tranches, s.entryPlan?.dropped], [['V-TRANCHE-ORDER'], null, []]);
  const ok = run(noTrade({ scenarios: [scn({ role: 'PRIMARY', tranches: [{ price: 99, weight: 0.6 }, { price: 98, weight: 0.4 }] })] }));
  assert.deepEqual([ok.entryPlan?.scenarios[0]?.tranchePlan?.avgEntry, ok.entryPlan?.scenarios[0]?.sizing?.entryPrice], [98.6, 98.6]);
});

test('P3-3-T3 scalp 응답에 tranches가 있어도 null로 정규화된다 (V-TRANCHE-MODE, 경고 없음). zone이 아닌 진입도 같다', () => {
  const o = run(proposal({ ...zone, tranches: three, scenarios: [breakout({ tranches: [{ price: 101.5, weight: 0.6 }, { price: 101, weight: 0.4 }] })] }), {}, 'scalp');
  assert.deepEqual([o.entryPlan?.tranchePlan, o.entryPlan?.trancheViolations, o.entryPlan?.warnings], [null, [], []]);
  assert.deepEqual([o.entryPlan?.scenarios[0]?.tranches, o.entryPlan?.scenarios[0]?.tranchePlan], [null, null]);
  assert.equal(o.sizing?.entryPrice, 100);
  const limit = run(proposal({ tranches: three }));
  assert.deepEqual([limit.entryPlan?.tranchePlan, limit.entryPlan?.warnings], [null, []]);
});

test('P3-3-T4 포지션 0건·총 자산만 있어도 ENTER_LONG·시나리오 수량이 계산된다. 총 자산이 없으면 수량은 생략되고 NO_EQUITY', () => {
  const p = proposal({ ...zone, tranches: three, scenarios: [breakout()] });
  const withEquity = run(p);
  assert.ok(withEquity.sizing && withEquity.entryPlan?.scenarios[0]?.sizing);
  for (const pc of [flat(null), null]) {
    const o = run(p, { positionContext: pc });
    assert.equal(o.sizing, null);
    assert.deepEqual(o.entryPlan?.warnings, ['NO_EQUITY']);
    const tp = o.entryPlan!.tranchePlan!;
    assert.deepEqual([tp.avgEntry, tp.totalQuantity, tp.lossAtStop, tp.rows.map((r) => [r.price, r.weight, r.quantity])],
      [98.6, null, null, [[100, 0.5, null], [98, 0.3, null], [96, 0.2, null]]]);
    assert.equal(o.entryPlan?.scenarios[0]?.sizing, null);
  }
});

test('P3-3-T5 perpetual 분할 진입의 V-LIQ-BUFFER는 가중 평균 진입가로 계산된다', () => {
  // 20배: 증거금 소진 거리 4.5%, 허용 손절 거리 2.25%. 구간 끝 100 기준 2.4%는 위반, 평균 99.5 기준 1.91%는 통과
  const base = { entry: { type: 'zone' as const, min: 99, max: 100 }, stopLoss: 97.6, leverage: 20 };
  const single = run(proposal(base));
  assert.deepEqual([single.action, single.violations.map((v) => v.code)], ['NO_TRADE', ['V-LIQ-BUFFER']]);
  const split = run(proposal({ ...base, tranches: [{ price: 100, weight: 0.5 }, { price: 99, weight: 0.5 }] }));
  assert.deepEqual([split.action, split.violations, split.risk?.basePrice], ['ENTER_LONG', [], 99.5]);
  assert.ok(split.risk?.assumptions.some((a) => a.includes('가중 평균')));
});

test('P3-6-T3 작업이 decision/4·entryPlan을 저장하고, 이전 decision/3 리포트·판정도 읽힌다. LAN 사본은 시나리오 수량을 가린다', async () => {
  const out = await runWithBook('algorithm', {}, [], bookRead('perpetual'));
  assert.equal(out.rec.state, 'COMPLETED');
  const d = out.d!;
  assert.deepEqual([d.action, d.schemaVersion, d.proposal?.schemaVersion], ['ENTER_LONG', 'decision/4', 'proposal/4']);
  assert.ok(d.entryPlan, '보유 없는 시장의 분석은 entryPlan을 가진다');

  const report = buildReport(out.job, { claudeCliVersion: '2.1.284 (Claude Code)' }, new Date(Date.parse(out.rec.createdAt) + 60_000));
  const { entryPlan: _e, ...d3 } = report.finalDecision;
  const oldDecision = { ...d3, schemaVersion: 'decision/3' } as unknown as Report['finalDecision'];
  const old = { ...report, finalDecision: oldDecision } as Report;
  assert.ok(renderMarkdown(old).length > 0);
  assert.ok(panelView(oldDecision, new Date(report.finalDecision.decidedAt)).headline.length > 0);
  assert.equal(maskDecision(oldDecision).entryPlan ?? null, null);

  // 마스킹: 수량·금액은 가리고 가격·비중·손익비는 남긴다
  const o = run(noTrade({ scenarios: [scn({ role: 'PRIMARY', tranches: [{ price: 99, weight: 0.6 }, { price: 98, weight: 0.4 }] })] }));
  const masked = maskDecision({ ...d, entryPlan: o.entryPlan });
  const s = masked.entryPlan!.scenarios[0]!;
  assert.deepEqual([s.sizing?.suggestedQuantity, s.tranchePlan?.totalQuantity, s.tranchePlan?.lossAtStop, s.tranchePlan?.rows[0]?.quantity, s.tranchePlan?.rows[0]?.cumulativeQuantity],
    [MASK, MASK, MASK, MASK, MASK]);
  assert.deepEqual([s.tranchePlan?.avgEntry, s.tranchePlan?.rows[0]?.price, s.tranchePlan?.rows[0]?.weight, s.rewardRisk], [98.6, 99, 0.6, 3.09]);
  assert.equal(typeof o.entryPlan!.scenarios[0]!.sizing!.suggestedQuantity, 'number', '원본은 바뀌지 않는다');
});
