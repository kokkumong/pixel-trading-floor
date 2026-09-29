// 가격 값 태그 (P1 명세 2.4). 통화가 다른 가격은 fx 정보 없이 비교하지 않는다 (P1-2-R7).
import type { Currency, MarketType } from '../schema/types.ts';

export interface FxInfo {
  rate: number; // 1 단위 원 통화 → 변환 통화
  pair: string; // 예: USDKRW
  sourceRef: string;
  observedAt: string | null;
}

export interface PriceTag {
  value: number;
  currency: Currency;
  marketType: MarketType;
  priceKind: 'last' | 'mark' | 'index' | 'close';
  sourceRef: string;
  estimated: boolean;
  fx?: FxInfo; // 통화 변환을 거친 값일 때만
}

export class CurrencyMismatchError extends Error {}

/** USDT를 USD와 같은 단위로 볼지는 호출자가 정한다. 여기서는 표기가 다르면 다른 통화로 본다. */
export function convert(p: PriceTag, to: Currency, fx: FxInfo): PriceTag {
  if (p.currency === to) return p;
  const pair = `${usdLike(p.currency) ? 'USD' : p.currency}${usdLike(to) ? 'USD' : to}`;
  const inverse = `${usdLike(to) ? 'USD' : to}${usdLike(p.currency) ? 'USD' : p.currency}`;
  let rate: number;
  if (fx.pair === pair) rate = fx.rate;
  else if (fx.pair === inverse) rate = 1 / fx.rate;
  else throw new CurrencyMismatchError(`환율 ${fx.pair}로 ${p.currency}→${to} 변환 불가`);
  return { ...p, value: p.value * rate, currency: to, fx };
}

/**
 * 괴리율 (a − b) / b. 두 가격의 통화가 같아야 한다. 한쪽이 변환된 값이면 fx가 반드시 채워져 있어야 한다.
 * USD와 USDT는 같은 통화로 보지 않는다 (호출자가 명시적으로 변환).
 */
export function spreadRatio(a: PriceTag, b: PriceTag): number {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(`통화가 다른 가격 비교 거부: ${a.currency} vs ${b.currency}`);
  if (b.value <= 0) throw new RangeError('기준 가격이 0 이하');
  return (a.value - b.value) / b.value;
}

function usdLike(c: Currency): boolean {
  return c === 'USD' || c === 'USDT';
}
