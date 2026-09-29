import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRules, DEFAULT_THRESHOLDS } from '../../src/core/rules/engine.ts';
import { actionBiasLabel, legacyToActionBias } from '../../src/core/rules/display.ts';
import { parseRef, resolvePointer } from '../../src/core/rules/evidence.ts';
import { evidence, proposal, ruleCtx } from '../helpers.ts';

const vcodes = (o: { violations: { code: string }[] }) => o.violations.map((v) => v.code);

test('정상 롱 제안은 PASS', () => {
  const o = applyRules(proposal(), ruleCtx());
  assert.equal(o.verdict, 'PASS');
  assert.equal(o.action, 'ENTER_LONG');
  assert.equal(o.status, 'VALID');
  assert.deepEqual(o.violations, []);
});

test('P0-3-T1 롱 손절가가 진입가보다 높으면 NO_TRADE + V-DIR-LONG, bias는 BULLISH 유지', () => {
  const o = applyRules(proposal({ stopLoss: 101 }), ruleCtx());
  assert.equal(o.action, 'NO_TRADE');
  assert.equal(o.verdict, 'DOWNGRADED');
  assert.ok(vcodes(o).includes('V-DIR-LONG'));
  assert.equal(o.bias, 'BULLISH');
  assert.equal(o.status, 'NO_TRADE');
});

test('P0-3-T2 한국 주식 현물에 숏(SELL) → 거래 없음 · 약세 전망 + SPOT_SHORT_NOT_ALLOWED', () => {
  const spot = proposal({
    instrumentId: 'KR:000660', marketType: 'spot', action: 'ENTER_SHORT', bias: 'BEARISH', leverage: null,
    priceBasis: { sourceRef: 'yahoo.spot.price', currency: 'KRW' },
    entry: { type: 'limit', min: 1_340_000, max: 1_340_000 }, stopLoss: 1_380_000, targets: [1_300_000],
  });
  const o = applyRules(spot, ruleCtx('algorithm', { riskPrice: null }));
  assert.equal(o.action, 'NO_TRADE');
  assert.ok(o.reasonCodes.includes('SPOT_SHORT_NOT_ALLOWED'));
  assert.equal(actionBiasLabel(o.action, o.bias), '거래 없음 · 약세 전망');

  const legacy = legacyToActionBias('SELL', 'spot', 'NEUTRAL');
  assert.deepEqual(legacy, { action: 'NO_TRADE', bias: 'BEARISH', reasonCodes: ['SPOT_SHORT_NOT_ALLOWED'] });
  assert.equal(actionBiasLabel(legacy!.action, legacy!.bias), '거래 없음 · 약세 전망');
});

test('P0-3-T5 알고리즘 모드 ENTER_LONG + BEARISH는 V-BIAS로 강등', () => {
  const o = applyRules(proposal({ bias: 'BEARISH' }), ruleCtx('algorithm'));
  assert.equal(o.action, 'NO_TRADE');
  assert.deepEqual(vcodes(o), ['V-BIAS']);
  assert.equal(o.bias, 'BEARISH');
});

test('V-DIR-SHORT 숏 방향 관계', () => {
  const short = { action: 'ENTER_SHORT' as const, bias: 'BEARISH' as const, stopLoss: 102, targets: [96] };
  assert.equal(applyRules(proposal(short), ruleCtx()).verdict, 'PASS');
  assert.ok(vcodes(applyRules(proposal({ ...short, targets: [101] }), ruleCtx())).includes('V-DIR-SHORT'));
});

test('market 진입은 기준 가격 소스의 현재가를 진입가로 검증한다', () => {
  const m = { entry: { type: 'market' as const, min: null, max: null } };
  assert.equal(applyRules(proposal({ ...m, stopLoss: 98 }), ruleCtx()).verdict, 'PASS');
  assert.ok(vcodes(applyRules(proposal({ ...m, stopLoss: 100.5 }), ruleCtx())).includes('V-DIR-LONG'));
});

test('V-STOP-REQUIRED 진입 제안에 손절가가 없으면 강등', () => {
  const o = applyRules(proposal({ stopLoss: null }), ruleCtx());
  assert.equal(o.action, 'NO_TRADE');
  assert.ok(vcodes(o).includes('V-STOP-REQUIRED'));
});

test('V-PRICE-BASIS 추정 시세나 없는 소스를 기준으로 쓰면 강등', () => {
  const est = applyRules(proposal({ priceBasis: { sourceRef: 'tapbit.perp.estimate', currency: 'USDT' } }), ruleCtx());
  assert.ok(vcodes(est).includes('V-PRICE-BASIS'));
  assert.equal(est.action, 'NO_TRADE');
  const missing = applyRules(proposal({ priceBasis: { sourceRef: 'nope', currency: 'USDT' } }), ruleCtx());
  assert.ok(vcodes(missing).includes('V-PRICE-BASIS'));
});

test('V-LEVERAGE-CAP 20배 초과, 현물 레버리지', () => {
  assert.ok(vcodes(applyRules(proposal({ leverage: 25 }), ruleCtx())).includes('V-LEVERAGE-CAP'));
});

test('V-VALIDITY 상한을 넘으면 잘라내고 경고만', () => {
  const o = applyRules(proposal({ validForMinutes: 500 }), ruleCtx('scalp'));
  assert.equal(o.validForMinutes, 240);
  assert.equal(o.verdict, 'PASS');
  assert.ok(o.warnings.some((w) => w.startsWith('V-VALIDITY')));
});

test('V-DATA-QUALITY 필수 데이터 부족이면 모든 모드에서 INSUFFICIENT_DATA', () => {
  for (const mode of ['algorithm', 'scalp', 'forced_direction'] as const) {
    const o = applyRules(proposal({ unforcedAction: mode === 'forced_direction' ? 'NO_TRADE' : null }), ruleCtx(mode, { dataQuality: 'INSUFFICIENT_DATA' }));
    assert.equal(o.status, 'INSUFFICIENT_DATA');
  }
});

test('강제 방향 모드: 방향 위반은 강등하지 않고 BLOCKED 표시만', () => {
  const o = applyRules(proposal({ stopLoss: 101, unforcedAction: 'NO_TRADE' }), ruleCtx('forced_direction'));
  assert.equal(o.verdict, 'BLOCKED');
  assert.equal(o.action, 'ENTER_LONG');
  assert.ok(vcodes(o).includes('V-DIR-LONG'));
});

test('모델이 NO_TRADE를 고르면 NO_EDGE', () => {
  const o = applyRules(proposal({ action: 'NO_TRADE', bias: 'NEUTRAL', stopLoss: null, targets: [], leverage: null }), ruleCtx());
  assert.equal(o.status, 'NO_TRADE');
  assert.equal(o.verdict, 'PASS');
  assert.deepEqual(o.reasonCodes, ['NO_EDGE']);
});

// P1-4 레버리지 위험 거리
test('P1-4-T1 20배 롱, 진입 100, 손절 97 → stopDistance 3%, bufferRatio 0.67, V-LIQ-BUFFER 위반', () => {
  const o = applyRules(proposal({ stopLoss: 97, targets: [106] }), ruleCtx());
  assert.equal(o.risk?.stopDistancePercent, 3);
  assert.equal(o.risk?.roughMarginLimitPercent, 4.5);
  assert.equal(Math.round(o.risk!.bufferRatio * 100) / 100, 0.67);
  assert.ok(vcodes(o).includes('V-LIQ-BUFFER'));
  assert.equal(o.risk?.estimatedLiquidationPrice, null);
});

test('P1-4-T2 같은 조건의 숏(진입 100, 손절 103)도 같은 결과', () => {
  const o = applyRules(proposal({ action: 'ENTER_SHORT', bias: 'BEARISH', stopLoss: 103, targets: [94] }), ruleCtx());
  assert.equal(o.risk?.stopDistancePercent, 3);
  assert.equal(Math.round(o.risk!.bufferRatio * 100) / 100, 0.67);
  assert.ok(vcodes(o).includes('V-LIQ-BUFFER'));
});

test('P1-4-T3 유지증거금 가정을 1%로 올리면 판정이 더 엄격해진다', () => {
  const p = proposal({ stopLoss: 97.9 }); // 2.1%: 0.5% 가정에서는 통과
  const loose = applyRules(p, ruleCtx());
  const strict = applyRules(p, ruleCtx('scalp', { thresholds: { ...DEFAULT_THRESHOLDS, assumedMaintenanceMargin: 0.01 } }));
  assert.equal(loose.verdict, 'PASS');
  assert.ok(strict.risk!.roughMarginLimitPercent < loose.risk!.roughMarginLimitPercent);
  assert.ok(vcodes(strict).includes('V-LIQ-BUFFER'));
});

test('V-STOP-NOISE 손절 폭이 ATR보다 좁으면 경고만', () => {
  const o = applyRules(proposal({ stopLoss: 99.5 }), ruleCtx('scalp', { atr14: 1.2 }));
  assert.equal(o.verdict, 'PASS');
  assert.ok(o.warnings.some((w) => w.startsWith('V-STOP-NOISE')));
});

// P1-10 근거 인용
test('P1-10-T2 존재하지 않는 snap: 참조는 근거 확인 불가 경고', () => {
  const o = applyRules(
    proposal({ evidenceRefs: ['derived:rsi14', 'snap:binance.perp.price#/last', 'snap:binance.perp.price#/nope'] }),
    ruleCtx(),
  );
  assert.equal(o.verdict, 'PASS');
  assert.ok(o.warnings.includes('근거 확인 불가: snap:binance.perp.price#/nope'));
});

test('P1-10-T3 유효 근거 1개로 ENTER_LONG → INSUFFICIENT_EVIDENCE 강등 (강제 방향은 경고만)', () => {
  const p = { evidenceRefs: ['derived:rsi14', 'derived:ma50', 'brief:TARO#c9'] };
  const o = applyRules(proposal(p), ruleCtx('algorithm'));
  assert.equal(o.action, 'NO_TRADE');
  assert.ok(o.reasonCodes.includes('INSUFFICIENT_EVIDENCE'));
  const f = applyRules(proposal({ ...p, unforcedAction: 'ENTER_LONG' }), ruleCtx('forced_direction'));
  assert.equal(f.verdict, 'PASS');
  assert.ok(f.warnings.some((w) => w.startsWith('V-EVIDENCE-REF')));
});

test('근거 참조 문법과 JSON 포인터', () => {
  assert.deepEqual(parseRef('snap:binance.perp.funding#/rate'), { kind: 'snap', sourceId: 'binance.perp.funding', pointer: '/rate' });
  assert.deepEqual(parseRef('brief:TARO#c2'), { kind: 'brief', role: 'TARO', claimId: 'c2' });
  assert.equal(parseRef('http://x'), null);
  assert.equal(resolvePointer({ a: [{ 'b/c': 1 }] }, '/a/0/b~1c'), 1);
  assert.equal(evidence.has('derived:macd.hist'), true);
  assert.equal(evidence.has('derived:ma50'), false); // null 값은 근거가 아님
  assert.equal(evidence.has('brief:TARO#c2'), true);
});
