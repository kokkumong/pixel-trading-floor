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
 * 분할 진입이면 avgEntry(가중 평균 진입가)를 기준으로 한다 (P3-3-R5).
 */
export function computeRisk(p: TradeProposal, riskPrice: RiskPrice | null, assumedMaintenanceMargin: number, avgEntry: number | null = null): RiskInfo | null {
  if (p.marketType !== 'perpetual' || p.leverage === null || p.stopLoss === null || p.action === 'NO_TRADE') return null;
  const long = p.action === 'ENTER_LONG';
  let basePrice: number;
  let basePriceKind: RiskInfo['basePriceKind'];
  if (avgEntry !== null) {
    basePrice = avgEntry;
    basePriceKind = 'entry';
  } else if (p.entry.type === 'market') {
    if (!riskPrice) return null;
    basePrice = riskPrice.value;
    basePriceKind = riskPrice.kind;
  } else {
    const edge = long ? p.entry.max : p.entry.min;
    if (edge === null) return null;
    basePrice = edge;
    basePriceKind = 'entry';
  }
  return riskDistance({ long, leverage: p.leverage, stopLoss: p.stopLoss, basePrice, basePriceKind, averaged: avgEntry !== null }, assumedMaintenanceMargin);
}

export interface RiskDistanceInput {
  long: boolean;
  leverage: number;
  stopLoss: number;
  basePrice: number;
  basePriceKind: RiskInfo['basePriceKind'];
  /** 기준 진입가가 분할 진입의 가중 평균이다 (P3-3-R5) */
  averaged?: boolean;
}

/** 기준 진입가·손절·레버리지로 위험 거리를 계산한다. 시나리오(P3-4-R2)도 같은 계산을 쓴다 */
export function riskDistance(x: RiskDistanceInput, assumedMaintenanceMargin: number): RiskInfo {
  const { long, basePrice, basePriceKind } = x;
  const roughMarginLimit = 1 / x.leverage - assumedMaintenanceMargin;
  const stopDistance = Math.abs(basePrice - x.stopLoss) / basePrice;
  return {
    leverage: x.leverage,
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
      `기준 가격: ${x.averaged ? '분할 진입 가중 평균' : basePriceKind === 'entry' ? '진입 구간 경계' : basePriceKind}`,
    ],
  };
}

function round(x: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
