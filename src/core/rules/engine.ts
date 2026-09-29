// 결정론적 위험 규칙 엔진 (P0 명세 3.6, P1 명세 4.2·10.2). 스키마 검증을 통과한 TradeProposal에만 적용한다.
// 모델 프롬프트에 같은 규칙이 있어도 이 코드가 최종 기준이다 (P0-3-R2).
import type { RiskInfo, RuleResult, RuleViolation } from '../schema/decision.ts';
import type { TradeProposal } from '../schema/proposal.ts';
import { MAX_LEVERAGE, MAX_VALID_MINUTES, type Action, type Bias, type DataQualityStatus, type Mode } from '../schema/types.ts';
import type { EvidenceIndex } from './evidence.ts';
import { computeRisk, type RiskPrice } from './risk.ts';

export const RULE_ENGINE_VERSION = 'rules/1';

export interface RuleThresholds {
  assumedMaintenanceMargin: number; // P1-4.1
  liqBufferRatio: number; // V-LIQ-BUFFER
  stopNoiseAtrMultiple: number; // V-STOP-NOISE
  minEvidenceForEntry: number; // P1-10-R2
}

export const DEFAULT_THRESHOLDS: RuleThresholds = {
  assumedMaintenanceMargin: 0.005,
  liqBufferRatio: 0.5,
  stopNoiseAtrMultiple: 1.0,
  minEvidenceForEntry: 2,
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
  thresholds?: RuleThresholds;
}

export interface RuleOutcome extends RuleResult {
  status: 'VALID' | 'NO_TRADE' | 'INSUFFICIENT_DATA';
  action: Action;
  bias: Bias;
  reasonCodes: string[];
  validForMinutes: number;
  risk: RiskInfo | null;
}

export function applyRules(p: TradeProposal, ctx: RuleContext): RuleOutcome {
  const t = ctx.thresholds ?? DEFAULT_THRESHOLDS;
  const forced = ctx.mode === 'forced_direction';
  const violations: RuleViolation[] = [];
  const warnings: string[] = [];
  const reasonCodes: string[] = [];
  const violate = (code: string, message: string, reason?: string) => {
    violations.push({ code, message });
    if (reason && !reasonCodes.includes(reason)) reasonCodes.push(reason);
  };

  // V-DATA-QUALITY: 모든 모드에서 작업 중단 (강제 방향도 근거 없는 데이터로는 만들지 않는다, D5)
  if (ctx.dataQuality === 'INSUFFICIENT_DATA') {
    return {
      status: 'INSUFFICIENT_DATA', action: 'NO_TRADE', bias: p.bias, reasonCodes: ['INSUFFICIENT_DATA'],
      verdict: 'BLOCKED', violations: [{ code: 'V-DATA-QUALITY', message: '필수 데이터 부족' }], warnings,
      validForMinutes: p.validForMinutes, risk: null,
    };
  }

  const entering = p.action !== 'NO_TRADE';
  const long = p.action === 'ENTER_LONG';

  // V-PRICE-BASIS: 기준 가격 소스는 실제 시세여야 한다 (P0-4-R3)
  const basis = ctx.sources[p.priceBasis.sourceRef];
  if (!basis) violate('V-PRICE-BASIS', `스냅샷에 없는 소스 ${p.priceBasis.sourceRef}`, 'PRICE_BASIS_INVALID');
  else if (basis.estimated) violate('V-PRICE-BASIS', '추정 시세는 판정 기준으로 쓸 수 없음', 'PRICE_BASIS_ESTIMATED');

  if (entering) {
    // V-BIAS: 강제 방향 외 모드에서 행동과 방향 판단이 맞아야 한다
    if (!forced && ((long && p.bias !== 'BULLISH') || (!long && p.bias !== 'BEARISH'))) {
      violate('V-BIAS', `${p.action}와 ${p.bias}가 맞지 않음`, 'BIAS_MISMATCH');
    }
    // V-SPOT-SHORT
    if (!long && p.marketType === 'spot') violate('V-SPOT-SHORT', '현물에서 숏 진입 불가', 'SPOT_SHORT_NOT_ALLOWED');
    // V-STOP-REQUIRED
    if (p.stopLoss === null) violate('V-STOP-REQUIRED', '진입 제안에는 손절가 필수', 'STOP_REQUIRED');
    // V-DIR-LONG / V-DIR-SHORT (market 진입은 기준 가격을 진입가로 쓴다)
    const ref = basis?.price ?? null;
    const lo = p.entry.type === 'market' ? ref : p.entry.min;
    const hi = p.entry.type === 'market' ? ref : p.entry.max;
    if (p.stopLoss !== null) {
      if (lo === null || hi === null) {
        violate('V-PRICE-BASIS', '방향 검증에 쓸 기준 가격 없음', 'PRICE_BASIS_INVALID');
      } else if (long) {
        const ok = p.stopLoss < lo && lo <= hi && p.targets.every((x) => hi < x);
        if (!ok) violate('V-DIR-LONG', '롱: 손절 < 진입 ≤ 목표 관계 위반', 'PRICE_DIRECTION_INVALID');
      } else {
        const ok = p.targets.every((x) => x < lo) && lo <= hi && hi < p.stopLoss;
        if (!ok) violate('V-DIR-SHORT', '숏: 목표 < 진입 < 손절 관계 위반', 'PRICE_DIRECTION_INVALID');
      }
    }
  }

  // V-LEVERAGE-CAP
  if (p.marketType === 'spot' && p.leverage !== null) violate('V-LEVERAGE-CAP', '현물은 레버리지 null', 'LEVERAGE_INVALID');
  if (p.leverage !== null && p.leverage > MAX_LEVERAGE) violate('V-LEVERAGE-CAP', `레버리지 상한 ${MAX_LEVERAGE}배 초과`, 'LEVERAGE_INVALID');

  // V-LIQ-BUFFER / V-STOP-NOISE (P1-4.2)
  const risk = entering ? computeRisk(p, ctx.riskPrice ?? (basis?.price ? { value: basis.price, kind: 'last' } : null), t.assumedMaintenanceMargin) : null;
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

  // V-EVIDENCE-REF (P1-10-R1, R2)
  const validRefs = p.evidenceRefs.filter((r) => ctx.evidence.has(r));
  for (const r of p.evidenceRefs) if (!ctx.evidence.has(r)) warnings.push(`근거 확인 불가: ${r}`);
  if (entering && validRefs.length < t.minEvidenceForEntry) {
    const msg = `유효 근거 ${validRefs.length}개 (최소 ${t.minEvidenceForEntry}개)`;
    if (forced) warnings.push(`V-EVIDENCE-REF: ${msg}`);
    else violate('V-EVIDENCE-REF', msg, 'INSUFFICIENT_EVIDENCE');
  }

  // V-VALIDITY: 상한으로 잘라내고 경고만
  let validForMinutes = p.validForMinutes;
  const cap = MAX_VALID_MINUTES[ctx.mode];
  if (validForMinutes > cap) {
    warnings.push(`V-VALIDITY: 유효 시간 ${validForMinutes}분을 상한 ${cap}분으로 줄임`);
    validForMinutes = cap;
  }

  // 판정. 강제 방향 모드는 강등하지 않고 BLOCKED 표시만 한다 (P0 명세 3.6 예외)
  let action = p.action;
  let verdict: RuleResult['verdict'] = 'PASS';
  if (violations.length > 0) {
    if (forced) {
      verdict = 'BLOCKED';
    } else {
      verdict = 'DOWNGRADED';
      action = 'NO_TRADE';
      reasonCodes.unshift('RULE_DOWNGRADED');
    }
  }
  if (p.action === 'NO_TRADE') reasonCodes.unshift('NO_EDGE');

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
  };
}
