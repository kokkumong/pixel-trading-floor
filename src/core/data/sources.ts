// 소스 기록 형식과 모드별 필수·선택 소스 계획 (P0 명세 4.2, 4.3).
import type { Currency, MarketType, Mode } from '../schema/types.ts';
import type { Candle } from './candles.ts';
import type { Instrument } from './registry.ts';

export type EndpointType = 'price' | 'candle' | 'news' | 'sentiment' | 'fx' | 'funding' | 'fundamentals';
export type SourceStatus = 'ok' | 'partial' | 'failed';

export interface PricePayload {
  last: number | null;
  mark: number | null;
  index: number | null;
  currency: Currency;
  marketType: MarketType;
}
export interface CandlePayload {
  interval: '15m' | '1d';
  candles: Candle[]; // 무결성 검사 전에는 원본, 스냅샷 안에서는 완성 봉만
  current?: Candle | null;
}
export interface FundingPayload {
  rate: number; // 부호 규약: 양수 = 롱이 숏에게 지급 (P1-3-R11)
  intervalHours: number;
  rate8h: number; // 8시간 환산
  nextFundingTime: string | null;
}
export interface FxPayload {
  pair: 'USDKRW';
  rate: number;
}
export interface NewsItem {
  title: string;
  source: string | null;
  publishedAt: string;
  summary: string | null;
}
export interface NewsPayload {
  items: NewsItem[];
}
export interface SentimentPayload {
  value: number;
  classification: string;
}
export interface FundamentalsPayload {
  marketCap: number | null;
  volume24h: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  circulatingSupply: number | null;
  currency: Currency;
}
export interface EstimatePayload {
  value: number | null; // 산출 불가면 null
  method: 'median';
  used: { exchange: string; price: number }[];
  excluded: { exchange: string; price: number; deviation: number }[];
  reason?: string;
}

export interface SourceRecord {
  id: string;
  provider: string;
  endpointType: EndpointType;
  observedAt: string | null;
  fetchedAt: string;
  status: SourceStatus;
  estimated: boolean;
  untrustedText: boolean;
  payload: unknown;
  error?: string;
  intervalSeconds?: number;
}

export interface SourceSpec {
  id: string;
  required: boolean;
}

export const INTERVAL_SECONDS = { '15m': 900, '1d': 86_400 } as const;
/** 지표 계산용 최소 봉 수 (P0 명세 4.3) */
export const MIN_BARS: Record<string, number> = { 'binance.spot.candles.1d': 60, 'yahoo.spot.candles.1d': 60, 'binance.perp.candles.15m': 96 };

/** 모드·종목별 수집 계획 (P0 명세 4.3 표) */
export function planSources(inst: Instrument, mode: Mode): SourceSpec[] {
  const req = (id: string): SourceSpec => ({ id, required: true });
  const opt = (id: string): SourceSpec => ({ id, required: false });
  const kr = inst.primaryMarket === 'KRX';
  const others = inst.perpetuals.filter((p) => !p.primary).map((p) => opt(`${p.exchange}.perp.price`));

  if (mode === 'algorithm') {
    if (inst.assetClass === 'crypto') {
      return [req('binance.spot.price'), req('binance.spot.candles.1d'), opt('coingecko.fundamentals'), opt('news.google'), opt('feargreed.alternative'), opt('binance.perp.price')];
    }
    const base = [req('yahoo.spot.price'), req('yahoo.spot.candles.1d'), opt('yahoo.fundamentals'), opt('news.google'), opt('feargreed.alternative')];
    if (!kr) return base;
    return [...base, req('yahoo.fx.usdkrw'), opt('binance.perp.price'), ...others];
  }
  const perp = [req('binance.perp.price'), req('binance.perp.candles.15m'), req('binance.perp.funding'), opt('feargreed.alternative'), opt('yahoo.fx.usdkrw')];
  return kr ? [...perp, opt('yahoo.spot.price'), ...others] : perp;
}

/** 판정 기준 캔들 소스 */
export function judgmentCandleSource(inst: Instrument, mode: Mode): string {
  if (mode !== 'algorithm') return 'binance.perp.candles.15m';
  return inst.assetClass === 'crypto' ? 'binance.spot.candles.1d' : 'yahoo.spot.candles.1d';
}

/** 판정 기준 가격 소스 (priceBasis 후보) */
export function judgmentPriceSource(inst: Instrument, mode: Mode): string {
  if (mode !== 'algorithm') return 'binance.perp.price';
  return inst.assetClass === 'crypto' ? 'binance.spot.price' : 'yahoo.spot.price';
}
