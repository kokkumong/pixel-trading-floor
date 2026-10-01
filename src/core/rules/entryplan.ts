// 진입 시나리오·분할 진입 규칙과 파생 값 (P3 신규 진입 명세 3·4장).
// 위반은 판정을 강등하지 않고 해당 시나리오(또는 tranches)만 제거한다 (D31). 수량·손익비·위험 거리는 코드가 계산한다 (P3-1-R5).
import type { PositionContext } from '../position/context.ts';
import type { DroppedScenario, EntryPlan, ScenarioPlan, TranchePlan } from '../schema/decision.ts';
import { MAX_SCENARIOS, type Scenario, type Tranche } from '../schema/proposal.ts';
import { MAX_LEVERAGE, type Bias, type EntryType, type MarketType, type Mode } from '../schema/types.ts';
import type { RuleThresholds } from './engine.ts';
import { riskDistance } from './risk.ts';
import { floorQty, r2, suggestSize } from './sizing.ts';

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const r8 = (x: number) => Math.round(x * 1e8) / 1e8;

export interface TrancheCheck {
  /** 규칙을 통과한 분할. 없거나 제거되면 null */
  tranches: Tranche[] | null;
  /** 제거 사유 (V-TRANCHE-SUM·ORDER·SPREAD). V-TRANCHE-MODE 정규화는 사유를 남기지 않는다 */
  violations: string[];
}

export interface TrancheTarget {
  mode: Mode;
  long: boolean;
  entry: { type: EntryType; min: number | null; max: number | null };
  stopLoss: number | null;
  atr14: number | null;
}

export function checkTranches(raw: Tranche[] | null, x: TrancheTarget, t: RuleThresholds): TrancheCheck {
  const { min, max } = x.entry;
  const stop = x.stopLoss;
  // V-TRANCHE-MODE: algorithm 모드의 zone 진입에서만 쓴다 (P3-3-R4)
  if (raw === null || x.mode !== 'algorithm' || x.entry.type !== 'zone' || min === null || max === null || stop === null) {
    return { tranches: null, violations: [] };
  }
  const violations: string[] = [];
  const sum = raw.reduce((a, r) => a + r.weight, 0);
  if (raw.length < 2 || raw.length > 3 || raw.some((r) => r.weight < 0.1 || r.weight > 0.8) || Math.abs(sum - 1) > 0.001) {
    violations.push('V-TRANCHE-SUM');
  }
  // P3-3-R2: 구간 안, 손절의 올바른 쪽, 불리한 방향으로 단계적
  const prices = raw.map((r) => r.price);
  const inside = prices.every((p) => p >= min && p <= max && (x.long ? p > stop : p < stop));
  const stepped = prices.every((p, i) => i === 0 || (x.long ? p < prices[i - 1]! : p > prices[i - 1]!));
  if (!inside || !stepped) violations.push('V-TRANCHE-ORDER');
  if (x.atr14 !== null && prices.some((p, i) => i > 0 && Math.abs(p - prices[i - 1]!) < t.trancheMinAtrSpread * x.atr14!)) {
    violations.push('V-TRANCHE-SPREAD');
  }
  return violations.length > 0 ? { tranches: null, violations } : { tranches: raw, violations };
}

/** 가중 평균 진입가 Σ(weight × price) (P3 3.2) */
export function averageEntry(tranches: readonly Tranche[]): number {
  const sum = tranches.reduce((a, r) => a + r.weight, 0);
  return r8(tranches.reduce((a, r) => a + r.weight * r.price, 0) / sum);
}

export interface TrancheSizing {
  stopLoss: number;
  /** 총 자산 × 손실 한도. 총 자산이 없으면 null → 수량 생략 (P3-3-R6) */
  riskBudget: number | null;
  instrumentId: string;
  marketType: MarketType;
  leverage: number | null;
}

/** Q = riskBudget ÷ |avgEntry − stopLoss|, qty_i = Q × weight_i (내림). 전부 체결 후 손절 손실이 예산 이하다 (P3-3-R1) */
export function planTranches(tranches: readonly Tranche[], x: TrancheSizing): TranchePlan {
  const avgEntry = averageEntry(tranches);
  const unit = Math.abs(avgEntry - x.stopLoss);
  const q = x.riskBudget === null || unit === 0 ? null : x.riskBudget / unit;
  let cum = 0;
  let loss = 0;
  const rows = tranches.map((r) => {
    if (q === null) return { price: r.price, weight: r.weight, quantity: null, cumulativeQuantity: null };
    const quantity = floorQty(q * r.weight, x.instrumentId);
    cum = r6(cum + quantity);
    loss += quantity * Math.abs(r.price - x.stopLoss);
    return { price: r.price, weight: r.weight, quantity, cumulativeQuantity: cum };
  });
  return {
    avgEntry,
    rows,
    totalQuantity: q === null ? null : cum,
    lossAtStop: q === null ? null : r6(loss),
    marginRequired: q === null || x.marketType !== 'perpetual' ? null : r2((cum * avgEntry) / (x.leverage ?? 1)),
  };
}

export interface EntryPlanInput {
  scenarios: readonly Scenario[];
  mode: Mode;
  marketType: MarketType;
  bias: Bias;
  /** 모델이 스스로 NO_TRADE를 냈다 (P3-2-R1). 규칙 강등은 해당하지 않는다 */
  modelNoTrade: boolean;
  /** 최종 판정이 ENTER_*일 때 지금 진입안의 방향과 구간 (V-SCN-DUP) */
  main: { long: boolean; lo: number; hi: number } | null;
  /** 현재가 (P2 3.2절 기준가) */
  cur: number | null;
  atr14: number | null;
  /** 상한으로 잘라낸 뒤의 유효 시간 */
  validForMinutes: number;
  positionContext: PositionContext | null;
  top: { tranchePlan: TranchePlan | null; violations: string[] };
}

/** 구간 겹침 비율: 겹친 길이 ÷ 더 좁은 구간의 길이. 한쪽이 점(지정가)이면 다른 구간 안에 있을 때 1 */
function overlap(a: { lo: number; hi: number }, b: { lo: number; hi: number }): number {
  const width = Math.min(a.hi - a.lo, b.hi - b.lo);
  const inter = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo);
  if (inter < 0) return 0;
  return width === 0 ? 1 : inter / width;
}

export function buildEntryPlan(x: EntryPlanInput, t: RuleThresholds): EntryPlan {
  const pc = x.positionContext;
  const equity = pc?.account.equity ?? null;
  const scenarios: ScenarioPlan[] = [];
  const dropped: DroppedScenario[] = [];
  let primarySeen = false;

  x.scenarios.forEach((s, index) => {
    const long = s.side === 'LONG';
    const { type, min, max } = s.entry;
    const drop = (codes: string[]) => dropped.push({ index, role: s.role, side: s.side, codes });
    const secondPrimary = s.role === 'PRIMARY' && primarySeen;
    if (s.role === 'PRIMARY') primarySeen = true;

    // V-SCN-SHAPE
    const shapeOk = index < MAX_SCENARIOS && !secondPrimary
      && (type === 'limit' ? min === max : type === 'zone' && min < max)
      && s.targets.length >= 1 && s.targets.length <= 3
      && (long || x.marketType === 'perpetual')
      && s.recheckAfterMinutes <= x.validForMinutes
      && s.invalidationConditions.length >= 1 && s.invalidationConditions.length <= 3;
    if (!shapeOk) return drop(['V-SCN-SHAPE']);
    // V-SCN-DIR (P0 V-DIR-*와 같음)
    const dirOk = long
      ? s.stopLoss < min && s.targets.every((v) => max < v)
      : s.targets.every((v) => v < min) && max < s.stopLoss;
    if (!dirOk) return drop(['V-SCN-DIR']);

    const codes: string[] = [];
    const { kind, level } = s.trigger;
    // V-SCN-TRIGGER: 현재가를 모르면 조건을 검증할 수 없으므로 제거한다
    const triggerOk = x.cur !== null && (kind === 'PULLBACK'
      ? (long ? level < x.cur : level > x.cur) && level >= min && level <= max
      : long ? level > x.cur && level <= min : level < x.cur && max <= level);
    if (!triggerOk) codes.push('V-SCN-TRIGGER');
    // V-SCN-DISTANCE
    if (x.cur !== null && x.atr14 !== null && Math.abs(level - x.cur) > t.scnMaxAtrDistance * x.atr14) codes.push('V-SCN-DISTANCE');
    // V-SCN-BIAS (P3-1-R4)
    if (s.role === 'PRIMARY' && x.bias !== 'NEUTRAL' && (x.bias === 'BULLISH') !== long) codes.push('V-SCN-BIAS');

    const tr = checkTranches(s.tranches, { mode: x.mode, long, entry: s.entry, stopLoss: s.stopLoss, atr14: x.atr14 }, t);
    const base = tr.tranches ? averageEntry(tr.tranches) : long ? max : min;

    // V-SCN-LEVERAGE: V-LEVERAGE-CAP과 V-LIQ-BUFFER를 시나리오 진입가·손절로 계산
    let risk: ScenarioPlan['risk'] = null;
    if (x.marketType === 'spot') {
      if (s.leverage !== null) codes.push('V-SCN-LEVERAGE');
    } else if (s.leverage === null || s.leverage > MAX_LEVERAGE) {
      codes.push('V-SCN-LEVERAGE');
    } else {
      risk = riskDistance({ long, leverage: s.leverage, stopLoss: s.stopLoss, basePrice: base, basePriceKind: 'entry', averaged: tr.tranches !== null }, t.assumedMaintenanceMargin);
      const limit = risk.roughMarginLimitPercent / 100;
      if (limit <= 0 || risk.stopDistancePercent / 100 > t.liqBufferRatio * limit) codes.push('V-SCN-LEVERAGE');
    }
    // V-SCN-DUP (P3-1-R3)
    if (x.main && x.main.long === long && overlap(x.main, { lo: min, hi: max }) > t.scnDupOverlap) codes.push('V-SCN-DUP');
    if (codes.length > 0) return drop(codes);

    // 파생 값 (P3-4-R2)
    const warnings: string[] = [];
    const rewardRisk = r2(Math.abs(s.targets[0]! - base) / Math.abs(base - s.stopLoss));
    if (rewardRisk < t.minRewardRisk) warnings.push('LOW_REWARD_RISK');
    if (tr.violations.length > 0) warnings.push('TRANCHE_DROPPED');
    const riskBudget = pc && equity !== null ? (equity * pc.account.riskPerTradePercent) / 100 : null;
    const tranchePlan = tr.tranches
      ? planTranches(tr.tranches, { stopLoss: s.stopLoss, riskBudget, instrumentId: pc?.instrumentId ?? '', marketType: x.marketType, leverage: s.leverage })
      : null;
    let sizing = pc && equity !== null ? suggestSize({
      instrumentId: pc.instrumentId, marketType: x.marketType, currency: pc.account.currency, equity,
      riskPerTradePercent: pc.account.riskPerTradePercent, entryPrice: base, stopLoss: s.stopLoss, leverage: s.leverage,
    }) : null;
    if (sizing && tranchePlan?.totalQuantity != null) sizing = { ...sizing, suggestedQuantity: tranchePlan.totalQuantity, marginRequired: tranchePlan.marginRequired };
    if (sizing && sizing.suggestedQuantity <= 0) sizing = null;
    scenarios.push({ ...s, tranches: tr.tranches, rewardRisk, sizing, risk, tranchePlan, trancheViolations: tr.violations, warnings });
  });

  const warnings: string[] = [];
  if (x.modelNoTrade && !scenarios.some((s) => s.role === 'PRIMARY')) warnings.push('NO_WAIT_PLAN');
  if (dropped.length > 0) warnings.push('SCN_DROPPED');
  if (x.top.violations.length > 0 || scenarios.some((s) => s.trancheViolations.length > 0)) warnings.push('TRANCHE_DROPPED');
  if (equity === null && (x.main !== null || scenarios.length > 0)) warnings.push('NO_EQUITY');
  return { tranchePlan: x.top.tranchePlan, trancheViolations: x.top.violations, scenarios, dropped, warnings };
}
