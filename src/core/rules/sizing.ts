// 리스크 예산 수량 제안 (P2 포지션 명세 3.3). 모델은 이 값을 모르고, 결과에 가정과 함께 표시한다 (P2-3-R4).
import type { Sizing } from '../schema/decision.ts';
import type { Currency, MarketType } from '../schema/types.ts';

export const MARGIN_HEAVY_RATIO = 0.5; // P2-3-R6

export interface SizingInput {
  instrumentId: string;
  marketType: MarketType;
  currency: Currency;
  equity: number;
  riskPerTradePercent: number;
  entryPrice: number;
  stopLoss: number;
  leverage: number | null;
  /** ADD만: 기존 포지션이 손절까지 갈 때의 손실. ENTER_*는 undefined */
  existingRisk?: number | undefined;
}

export const r2 = (x: number) => Math.round(x * 100) / 100;

/** 코인은 소수 6자리, 주식은 1주 단위로 내림한다 */
export function floorQty(q: number, instrumentId: string): number {
  const f = instrumentId.startsWith('CRYPTO:') ? 1e6 : 1;
  return Math.floor(q * f + 1e-9) / f;
}

/** 손절 거리가 0이면 null */
export function suggestSize(x: SizingInput): Sizing | null {
  const unitRisk = Math.abs(x.entryPrice - x.stopLoss);
  if (unitRisk === 0) return null;
  const riskBudget = (x.equity * x.riskPerTradePercent) / 100;
  const adding = x.existingRisk !== undefined;
  const addableRisk = adding ? Math.max(0, riskBudget - x.existingRisk!) : null;
  const suggestedQuantity = floorQty((addableRisk ?? riskBudget) / unitRisk, x.instrumentId);
  const marginRequired = x.marketType === 'perpetual' ? r2((suggestedQuantity * x.entryPrice) / (x.leverage ?? 1)) : null;
  return {
    suggestedQuantity,
    currency: x.currency,
    riskPerTradePercent: x.riskPerTradePercent,
    riskBudget: r2(riskBudget),
    entryPrice: x.entryPrice,
    stopLoss: x.stopLoss,
    existingRisk: adding ? r2(x.existingRisk!) : null,
    addableRisk: addableRisk === null ? null : r2(addableRisk),
    marginRequired,
    assumptions: [`총 자산 대비 손실 한도 ${x.riskPerTradePercent}% 기준`, '수수료·슬리피지·펀딩비 미반영', '참고용'],
  };
}

export function marginHeavy(s: Sizing, equity: number): boolean {
  return s.marginRequired !== null && s.marginRequired > MARGIN_HEAVY_RATIO * equity;
}
