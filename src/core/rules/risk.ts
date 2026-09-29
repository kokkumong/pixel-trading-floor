// 레버리지 위험 거리 (P1 명세 4장). 거래소 미지정 상태의 단순 계산만 하고 청산가는 계산하지 않는다.
import type { RiskInfo } from '../schema/decision.ts';
import type { TradeProposal } from '../schema/proposal.ts';

export interface RiskPrice {
  value: number;
  kind: 'mark' | 'last';
}

/**
 * perpetual + leverage + ENTER_* + stopLoss가 모두 있을 때만 계산한다. 그 외에는 null.
 * 기준 진입가: market이면 위험 계산 가격(mark 우선), 그 외에는 진입 구간에서 손절과 가장 먼 쪽 (보수적 가정).
 */
export function computeRisk(p: TradeProposal, riskPrice: RiskPrice | null, assumedMaintenanceMargin: number): RiskInfo | null {
  if (p.marketType !== 'perpetual' || p.leverage === null || p.stopLoss === null || p.action === 'NO_TRADE') return null;
  const long = p.action === 'ENTER_LONG';
  let basePrice: number;
  let basePriceKind: RiskInfo['basePriceKind'];
  if (p.entry.type === 'market') {
    if (!riskPrice) return null;
    basePrice = riskPrice.value;
    basePriceKind = riskPrice.kind;
  } else {
    const edge = long ? p.entry.max : p.entry.min;
    if (edge === null) return null;
    basePrice = edge;
    basePriceKind = 'entry';
  }
  const roughMarginLimit = 1 / p.leverage - assumedMaintenanceMargin;
  const stopDistance = Math.abs(basePrice - p.stopLoss) / basePrice;
  return {
    leverage: p.leverage,
    marginMode: 'unspecified',
    liquidationEstimateType: 'rough',
    estimatedLiquidationPrice: null,
    assumedMaintenanceMargin,
    basePrice,
    basePriceKind,
    roughMarginLimitPercent: round(roughMarginLimit * 100, 6),
    roughMarginLimitPrice: basePrice * (long ? 1 - roughMarginLimit : 1 + roughMarginLimit),
    stopDistancePercent: round(stopDistance * 100, 6),
    bufferRatio: roughMarginLimit > 0 ? round(stopDistance / roughMarginLimit, 6) : Number.POSITIVE_INFINITY,
    assumptions: [
      '거래소 미지정',
      `유지증거금 ${round(assumedMaintenanceMargin * 100, 4)}% 가정`,
      '수수료·펀딩비·슬리피지 미반영',
      `기준 가격: ${basePriceKind === 'entry' ? '진입 구간 경계' : basePriceKind}`,
    ],
  };
}

function round(x: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
