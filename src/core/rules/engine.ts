// 결정론적 위험 규칙 엔진 (P0 명세 3.6, P1 명세 4.2·10.2, P2 포지션 명세 3장). 스키마 검증을 통과한 TradeProposal에만 적용한다.
// 모델 프롬프트에 같은 규칙이 있어도 이 코드가 최종 기준이다 (P0-3-R2).
import type { PositionContext } from '../position/context.ts';
import type { PositionPlan, RiskInfo, RuleResult, RuleViolation, Sizing } from '../schema/decision.ts';
import type { TradeProposal } from '../schema/proposal.ts';
import { MAX_LEVERAGE, MAX_VALID_MINUTES, type Action, type Bias, type DataQualityStatus, type Mode } from '../schema/types.ts';
import type { EvidenceIndex } from './evidence.ts';
import { computeRisk, type RiskPrice } from './risk.ts';
import { marginHeavy, suggestSize } from './sizing.ts';

export const RULE_ENGINE_VERSION = 'rules/2';

export interface RuleThresholds {
  assumedMaintenanceMargin: number; // P1-4.1
  liqBufferRatio: number; // V-LIQ-BUFFER
  stopNoiseAtrMultiple: number; // V-STOP-NOISE
  minEvidenceForEntry: number; // P1-10-R2 (HOLD·ADD도 같음, P2-4-R4)
  liqNearAtrMultiple: number; // V-POS-LIQ-NEAR
}

export const DEFAULT_THRESHOLDS: RuleThresholds = {
  assumedMaintenanceMargin: 0.005,
  liqBufferRatio: 0.5,
  stopNoiseAtrMultiple: 1.0,
  minEvidenceForEntry: 2,
  liqNearAtrMultiple: 2,
};

export interface RuleContext {
  mode: Mode;
  dataQuality: DataQualityStatus;
  /** 스냅샷 sources[].id → 추정 여부와 그 소스의 현재가 */
  sources: Readonly<Record<string, { estimated: boolean; price: number | null }>>;
  /** 위험 거리 계산용 가격 (무기한: mark 우선, 없으면 last) */
  riskPrice: RiskPrice | null;
  atr14: number | null;
  evidence: EvidenceIndex;
  /** 작업에 고정된 포지션 컨텍스트 (강제 방향은 무시). 포지션이 없어도 총 자산이 있으면 수량 제안에 쓴다 */
  positionContext?: PositionContext | null;
  thresholds?: RuleThresholds;
}

export interface RuleOutcome extends RuleResult {
  status: 'VALID' | 'NO_TRADE' | 'INSUFFICIENT_DATA';
  action: Action;
  bias: Bias;
  reasonCodes: string[];
  validForMinutes: number;
  risk: RiskInfo | null;
  positionPlan: PositionPlan | null;
  sizing: Sizing | null;
}

export function applyRules(p: TradeProposal, ctx: RuleContext): RuleOutcome {
  const t = ctx.thresholds ?? DEFAULT_THRESHOLDS;
  const forced = ctx.mode === 'forced_direction';
  const violations: RuleViolation[] = [];
  const warnings: string[] = [];
  const reasonCodes: string[] = [];
  const reason = (code: string) => { if (!reasonCodes.includes(code)) reasonCodes.push(code); };
  const violate = (code: string, message: string, r?: string) => {
    violations.push({ code, message });
    if (r) reason(r);
  };

  // V-DATA-QUALITY: 모든 모드에서 작업 중단 (강제 방향도 근거 없는 데이터로는 만들지 않는다, D5)
  if (ctx.dataQuality === 'INSUFFICIENT_DATA') {
    return {
      status: 'INSUFFICIENT_DATA', action: 'NO_TRADE', bias: p.bias, reasonCodes: ['INSUFFICIENT_DATA'],
      verdict: 'BLOCKED', violations: [{ code: 'V-DATA-QUALITY', message: '필수 데이터 부족' }], warnings,
      validForMinutes: p.validForMinutes, risk: null, positionPlan: null, sizing: null,
    };
  }

  const pc = forced ? null : ctx.positionContext ?? null;
  const held = pc?.position ?? null;

  // V-PRICE-BASIS: 기준 가격 소스는 실제 시세여야 한다 (P0-4-R3)
  const basis = ctx.sources[p.priceBasis.sourceRef];
  if (!basis) violate('V-PRICE-BASIS', `스냅샷에 없는 소스 ${p.priceBasis.sourceRef}`, 'PRICE_BASIS_INVALID');
  else if (basis.estimated) violate('V-PRICE-BASIS', '추정 시세는 판정 기준으로 쓸 수 없음', 'PRICE_BASIS_ESTIMATED');
  const riskPrice = ctx.riskPrice ?? (basis?.price ? { value: basis.price, kind: 'last' as const } : null);

  // 보유 포지션에 적용할 손절·목표. HOLD·ADD만 갱신하고(V-STOP-WIDEN), EXIT·REDUCE는 무시한다(V-EXIT-CONSISTENCY)
  let plan: PositionPlan | null = null;
  if (held) {
    plan = { positionRef: held.id, side: held.side, stopLoss: held.stopLoss, targets: held.targets, stopUpdated: false, sizeFraction: p.sizeFraction };
    if (p.action === 'HOLD' || p.action === 'ADD') {
      if (p.stopLoss !== null && p.stopLoss !== held.stopLoss) {
        const widen = held.stopLoss !== null && (held.side === 'LONG' ? p.stopLoss < held.stopLoss : p.stopLoss > held.stopLoss);
        if (widen) {
          warnings.push(`V-STOP-WIDEN: 손절을 ${held.stopLoss}에서 ${p.stopLoss}로 넓히는 갱신은 무시하고 기존 손절 유지`);
          reason('STOP_WIDEN_IGNORED');
        } else {
          plan.stopLoss = p.stopLoss;
          plan.stopUpdated = true;
        }
      }
      if (p.targets.length > 0) plan.targets = p.targets;
    }
  }

  // 진입으로 검사할 제안: ENTER_*는 그대로, ADD는 보유 방향 진입 + 적용 손절·목표 (P2-4-R3 c)
  const entry: TradeProposal | null = p.action === 'ENTER_LONG' || p.action === 'ENTER_SHORT' ? p
    : p.action === 'ADD' && held && plan
      ? { ...p, action: held.side === 'LONG' ? 'ENTER_LONG' : 'ENTER_SHORT', stopLoss: plan.stopLoss, targets: plan.targets, leverage: p.leverage ?? held.leverage }
      : null;

  if (entry) {
    const long = entry.action === 'ENTER_LONG';
    // V-BIAS: 강제 방향 외 모드에서 행동과 방향 판단이 맞아야 한다
    if (!forced && ((long && p.bias !== 'BULLISH') || (!long && p.bias !== 'BEARISH'))) {
      violate('V-BIAS', `${p.action}와 ${p.bias}가 맞지 않음`, 'BIAS_MISMATCH');
    }
    // V-SPOT-SHORT
    if (!long && entry.marketType === 'spot') violate('V-SPOT-SHORT', '현물에서 숏 진입 불가', 'SPOT_SHORT_NOT_ALLOWED');
    // V-STOP-REQUIRED
    if (entry.stopLoss === null) violate('V-STOP-REQUIRED', '진입 제안에는 손절가 필수', 'STOP_REQUIRED');
    // V-DIR-LONG / V-DIR-SHORT (market 진입은 기준 가격을 진입가로 쓴다)
    const ref = basis?.price ?? null;
    const lo = entry.entry.type === 'market' ? ref : entry.entry.min;
    const hi = entry.entry.type === 'market' ? ref : entry.entry.max;
    if (entry.stopLoss !== null) {
      if (lo === null || hi === null) {
        violate('V-PRICE-BASIS', '방향 검증에 쓸 기준 가격 없음', 'PRICE_BASIS_INVALID');
      } else if (long) {
        const ok = entry.stopLoss < lo && lo <= hi && entry.targets.every((x) => hi < x);
        if (!ok) violate('V-DIR-LONG', '롱: 손절 < 진입 ≤ 목표 관계 위반', 'PRICE_DIRECTION_INVALID');
      } else {
        const ok = entry.targets.every((x) => x < lo) && lo <= hi && hi < entry.stopLoss;
        if (!ok) violate('V-DIR-SHORT', '숏: 목표 < 진입 < 손절 관계 위반', 'PRICE_DIRECTION_INVALID');
      }
    }
  }

  // V-LEVERAGE-CAP
  if (p.marketType === 'spot' && p.leverage !== null) violate('V-LEVERAGE-CAP', '현물은 레버리지 null', 'LEVERAGE_INVALID');
  if (p.leverage !== null && p.leverage > MAX_LEVERAGE) violate('V-LEVERAGE-CAP', `레버리지 상한 ${MAX_LEVERAGE}배 초과`, 'LEVERAGE_INVALID');

  // V-LIQ-BUFFER / V-STOP-NOISE (P1-4.2). 사용자가 청산가를 넣은 포지션은 V-POS-LIQ-BUFFER로 대신한다
  const risk = entry && held?.liquidationPrice == null ? computeRisk(entry, riskPrice, t.assumedMaintenanceMargin) : null;
  if (risk) {
    const limit = risk.roughMarginLimitPercent / 100;
    const stop = risk.stopDistancePercent / 100;
    if (limit <= 0 || stop > t.liqBufferRatio * limit) {
      violate('V-LIQ-BUFFER', `손절 거리 ${risk.stopDistancePercent}%가 증거금 소진 거리의 ${t.liqBufferRatio}배를 넘음`, 'LIQUIDATION_BUFFER');
    }
    const px = ctx.riskPrice?.value ?? basis?.price ?? null;
    if (ctx.atr14 !== null && px) {
      const noise = (t.stopNoiseAtrMultiple * ctx.atr14) / px;
      if (stop < noise) warnings.push(`V-STOP-NOISE: 손절 거리가 ATR(14)×${t.stopNoiseAtrMultiple}보다 좁음`);
    }
  }

  // 보유 포지션 규칙 (P2 3.1). 현재가는 포지션 컨텍스트의 기준 가격(mark 우선)
  const cur = pc?.price?.value ?? riskPrice?.value ?? null;
  if (held && plan && cur !== null) {
    const long = held.side === 'LONG';
    const keeping = p.action === 'HOLD' || p.action === 'ADD';
    // V-POS-STOP-DIR: 적용 손절이 현재가의 올바른 쪽에 있어야 유지할 수 있다
    if (keeping && plan.stopLoss !== null && (long ? plan.stopLoss >= cur : plan.stopLoss <= cur)) {
      violate('V-POS-STOP-DIR', `현재가 ${cur}가 이미 손절 ${plan.stopLoss}를 넘어섬`, 'STOP_ALREADY_HIT');
    }
    const liq = held.liquidationPrice;
    if (liq !== null) {
      const liqDist = Math.abs(cur - liq);
      // V-POS-LIQ-BUFFER: 손절 거리 ≤ 0.5 × 청산 거리 (사용자 입력 청산가 기준)
      if (keeping && plan.stopLoss !== null && Math.abs(cur - plan.stopLoss) > t.liqBufferRatio * liqDist) {
        const msg = `손절 거리가 청산가 거리의 ${t.liqBufferRatio}배를 넘음`;
        if (p.action === 'ADD') violate('V-POS-LIQ-BUFFER', msg, 'LIQUIDATION_BUFFER');
        else warnings.push(`V-POS-LIQ-BUFFER: ${msg}`);
      }
      // V-POS-LIQ-NEAR: 청산가가 ATR(14)×2 안이면 위험 근접. ADD만 막고 행동은 모델 판단을 따른다
      if (ctx.atr14 !== null && liqDist < t.liqNearAtrMultiple * ctx.atr14) {
        reason('LIQUIDATION_NEAR');
        const msg = `청산가 근접: 현재가~청산가 ${round(liqDist)} < ATR(14)×${t.liqNearAtrMultiple}`;
        if (p.action === 'ADD') violate('V-POS-LIQ-NEAR', msg);
        else warnings.push(`V-POS-LIQ-NEAR: ${msg}`);
      }
    }
  }

  // V-EVIDENCE-REF (P1-10-R1, R2). HOLD도 판단 회피가 되지 않게 근거와 무효화 조건을 요구한다 (P2-4-R4)
  const validRefs = p.evidenceRefs.filter((r) => ctx.evidence.has(r));
  for (const r of p.evidenceRefs) if (!ctx.evidence.has(r)) warnings.push(`근거 확인 불가: ${r}`);
  if ((entry || p.action === 'HOLD') && validRefs.length < t.minEvidenceForEntry) {
    const msg = `유효 근거 ${validRefs.length}개 (최소 ${t.minEvidenceForEntry}개)`;
    if (forced) warnings.push(`V-EVIDENCE-REF: ${msg}`);
    else violate('V-EVIDENCE-REF', msg, 'INSUFFICIENT_EVIDENCE');
  }
  if (p.action === 'HOLD' && p.invalidationConditions.length === 0) {
    violate('V-HOLD-INVALIDATION', '유지 판단을 뒤집을 조건(invalidationConditions)이 없음', 'INSUFFICIENT_EVIDENCE');
  }

  // V-RISK-BUDGET · 수량 제안 (P2-3.3). 총 자산이 없으면 제안하지 않는다
  let sizing: Sizing | null = null;
  const equity = pc?.account.equity ?? null;
  if (pc && entry && entry.stopLoss !== null && equity !== null) {
    const entryPrice = entry.entry.type === 'market' ? cur
      : entry.action === 'ENTER_LONG' ? entry.entry.max : entry.entry.min;
    let existingRisk: number | undefined;
    if (held) {
      // P2-3-R5: 기존 포지션에 손절이 없으면 열린 리스크를 알 수 없다
      if (held.stopLoss === null) reason('NO_STOP_ON_POSITION');
      else existingRisk = Math.max(0, (held.avgEntryPrice - entry.stopLoss) * (held.side === 'LONG' ? 1 : -1)) * held.quantity;
    }
    if (entryPrice !== null && (!held || existingRisk !== undefined)) {
      sizing = suggestSize({
        instrumentId: pc.instrumentId, marketType: pc.marketType, currency: pc.account.currency, equity,
        riskPerTradePercent: pc.account.riskPerTradePercent, entryPrice, stopLoss: entry.stopLoss, leverage: entry.leverage, existingRisk,
      });
    }
    if (sizing && sizing.suggestedQuantity <= 0) {
      if (held) violate('V-RISK-BUDGET', `남은 손실 한도 ${sizing.addableRisk} ${sizing.currency} — 추가 진입 여유 없음`, 'RISK_BUDGET_FULL');
      else warnings.push('V-RISK-BUDGET: 손실 한도 안에서 제안할 수량이 없음');
      sizing = null;
    }
    if (sizing && marginHeavy(sizing, equity)) {
      reason('MARGIN_HEAVY');
      warnings.push(`MARGIN_HEAVY: 필요 증거금이 총 자산의 50%를 넘음`);
    }
  }

  // V-VALIDITY: 상한으로 잘라내고 경고만
  let validForMinutes = p.validForMinutes;
  const cap = MAX_VALID_MINUTES[ctx.mode];
  if (validForMinutes > cap) {
    warnings.push(`V-VALIDITY: 유효 시간 ${validForMinutes}분을 상한 ${cap}분으로 줄임`);
    validForMinutes = cap;
  }

  // 판정. 강제 방향 모드는 강등하지 않고 BLOCKED 표시만 한다 (P0 명세 3.6 예외). 보유 중 강등은 HOLD (P2 3장)
  let action: Action = p.action;
  let verdict: RuleResult['verdict'] = 'PASS';
  if (violations.length > 0) {
    if (forced) {
      verdict = 'BLOCKED';
    } else {
      verdict = 'DOWNGRADED';
      action = held ? 'HOLD' : 'NO_TRADE';
      reasonCodes.unshift('RULE_DOWNGRADED');
      // 강등되면 모델의 갱신·수량 제안은 쓰지 않는다
      if (plan && held) plan = { ...plan, stopLoss: held.stopLoss, targets: held.targets, stopUpdated: false };
      sizing = null;
    }
  }
  if (p.action === 'NO_TRADE') reasonCodes.unshift('NO_EDGE');
  if (plan && action !== 'REDUCE') plan = { ...plan, sizeFraction: null };

  return {
    status: action === 'NO_TRADE' ? 'NO_TRADE' : 'VALID',
    action,
    bias: p.bias, // 강등되어도 모델의 방향 판단은 유지
    reasonCodes,
    verdict,
    violations,
    warnings,
    validForMinutes,
    risk,
    positionPlan: plan,
    sizing,
  };
}

function round(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}
