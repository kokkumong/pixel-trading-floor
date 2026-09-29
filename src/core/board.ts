// 전광판 시세 (가이드 4-1, 4-4). 분석 스냅샷과 별개로, 화면에 현재 시세·일봉 차트·한국 종목 멀티 거래소 표를 보인다.
// 판정에 쓰지 않는 표시 전용 값이다. 추정 시세는 배지·산출 거래소·산출 시각을 붙여 직접 시세와 구분한다 (P1-2-R10, R11).
// collectBoardSources는 네트워크를 쓰고, buildBoard는 순수 함수라 녹화 fixture와 데모 기록으로 테스트한다 (P1-8-R5).
import type { Currency } from './schema/types.ts';
import { binancePerp, binanceSpot, otherPerp, yahooFx, yahooStock } from './data/adapters.ts';
import { marketStatus } from './data/calendar.ts';
import { checkCandles, type Candle } from './data/candles.ts';
import { estimatePrice } from './data/estimate.ts';
import { sma } from './data/indicators.ts';
import type { NetClient } from './data/net.ts';
import { convert, spreadRatio, type PriceTag } from './data/price.ts';
import { describeMarket, exchangeLabel, type Instrument } from './data/registry.ts';
import { INTERVAL_SECONDS, type CandlePayload, type FundingPayload, type FxPayload, type PricePayload, type SourceRecord } from './data/sources.ts';

/** 화면 갱신 주기 (가이드 4-4) */
export const BOARD_REFRESH_SECONDS = 15;
export const BOARD_ESTIMATE_BADGE = '추정 · 직접 체결가 아님'; // P1-2-R10
const CHART_BARS = 120;
/** 장 마감 시세가 마감 시각보다 조금 늦게 찍혀도 같은 거래일로 본다 */
const SESSION_GRACE_MS = 60 * 60_000;

export interface BoardPerp {
  exchange: string;
  label: string;
  symbol: string;
  status: 'ok' | 'failed';
  last: number | null;
  mark: number | null;
  index: number | null;
  /** 8시간 환산 펀딩비 (Binance만) */
  fundingRate8h: number | null;
  /** 환율로 환산한 원화 값 (USDT = USD 가정) */
  krw: number | null;
  observedAt: string | null;
  error?: string;
}

export interface MultiBoard {
  fx: { rate: number; sourceRef: string; observedAt: string | null } | null;
  krxSpot: { value: number; currency: 'KRW'; usd: number | null; observedAt: string | null } | null;
  perps: BoardPerp[];
  estimate: {
    badge: typeof BOARD_ESTIMATE_BADGE;
    value: number | null;
    exchanges: string[];
    excluded: string[];
    computedAt: string;
    reason?: string;
  };
  /** 선물(Binance, 원화 환산) ↔ KRX 현물 괴리 */
  spread: { value: number; assumptions: string[] } | null;
}

export interface Board {
  schemaVersion: 'board/1';
  instrumentId: string;
  displayName: string;
  /** P1-2-R4: 해석된 종목 */
  description: string;
  demo: boolean;
  builtAt: string;
  market: { state: string; label: string; timezone: string };
  price: {
    value: number;
    currency: Currency;
    sourceRef: string;
    observedAt: string | null;
    /** 직전 완성 봉 종가 대비 변화율 (0.01 = 1%) */
    changeRatio: number | null;
  } | null;
  chart: {
    interval: '1d' | '15m';
    sourceRef: string;
    timezone: string;
    points: { t: number; close: number }[];
    ma20: (number | null)[];
    ma50: (number | null)[];
    high20: number | null;
    low20: number | null;
  } | null;
  multi: MultiBoard | null;
  warnings: string[];
}

/** 전광판에 필요한 소스만 조회한다 (가격·일봉, 한국 종목은 환율과 거래소별 무기한). 뉴스·심리 지표는 조회하지 않는다 */
export async function collectBoardSources(net: NetClient, inst: Instrument): Promise<SourceRecord[]> {
  const tasks: Promise<SourceRecord | SourceRecord[]>[] = [];
  if (inst.spot.binance) tasks.push(binanceSpot(net, inst, true));
  else if (inst.spot.yahoo) tasks.push(yahooStock(net, inst));
  if (inst.primaryMarket === 'KRX') {
    tasks.push(yahooFx(net));
    const primary = inst.perpetuals.find((p) => p.primary);
    if (primary) tasks.push(binancePerp(net, primary.symbol, false));
    for (const p of inst.perpetuals.filter((x) => !x.primary)) tasks.push(otherPerp(net, p.exchange, p.symbol));
  }
  return (await Promise.all(tasks)).flat();
}

const PRICE_SOURCES = ['binance.spot.price', 'yahoo.spot.price', 'binance.perp.price'] as const;
const CANDLE_SOURCES = ['binance.spot.candles.1d', 'yahoo.spot.candles.1d', 'binance.perp.candles.15m'] as const;

/** 순수 함수: 수집 기록 → 전광판. now는 캔들 완성 판정과 시장 상태 기준 시각 (데모는 녹화 시각) */
export function buildBoard(inst: Instrument, records: readonly SourceRecord[], now: Date, demo: boolean): Board {
  const warnings: string[] = [];
  const ok = (id: string) => records.find((r) => r.id === id && r.status !== 'failed');
  for (const r of records) if (r.status === 'failed') warnings.push(`${r.id}: ${r.error ?? '실패'}`);

  // 차트: 완성 봉만 (미완성 현재 봉은 가격으로 대신한다)
  let chart: Board['chart'] = null;
  let bars: Candle[] = [];
  const candleRec = CANDLE_SOURCES.map(ok).find((r) => r !== undefined);
  if (candleRec) {
    const p = candleRec.payload as CandlePayload;
    const chk = checkCandles(p.candles, { intervalMs: (candleRec.intervalSeconds ?? INTERVAL_SECONDS[p.interval]) * 1000, now, calendar: inst.calendarId, label: candleRec.id });
    warnings.push(...chk.warnings);
    bars = chk.candles.slice(-CHART_BARS);
    if (bars.length > 0) {
      const closes = chk.candles.map((c) => c.close);
      const offset = chk.candles.length - bars.length;
      const series = (n: number) => bars.map((_, i) => sma(closes.slice(0, offset + i + 1), n));
      const last20 = bars.slice(-20);
      chart = {
        interval: p.interval, sourceRef: candleRec.id, timezone: inst.timezone,
        points: bars.map((c) => ({ t: c.openTime, close: c.close })),
        ma20: series(20), ma50: series(50),
        high20: Math.max(...last20.map((c) => c.high)), low20: Math.min(...last20.map((c) => c.low)),
      };
    }
  }

  let price: Board['price'] = null;
  const priceRec = PRICE_SOURCES.map(ok).find((r) => r !== undefined && (r.payload as PricePayload).last !== null);
  if (priceRec) {
    const p = priceRec.payload as PricePayload;
    const last = p.last!;
    // 코인은 마지막 완성 봉 종가와 비교한다. 주식은 가격이 마지막 봉의 마감 시세이면(장 마감 뒤) 그 전 거래일 종가와 비교한다
    const obs = priceRec.observedAt ? Date.parse(priceRec.observedAt) : now.getTime();
    const lastBar = bars.at(-1);
    const sameSession = inst.calendarId !== 'CRYPTO_24_7' && lastBar !== undefined && obs <= lastBar.closeTime + SESSION_GRACE_MS;
    const ref = sameSession ? bars.at(-2)?.close : lastBar?.close;
    price = { value: last, currency: p.currency, sourceRef: priceRec.id, observedAt: priceRec.observedAt, changeRatio: ref ? (last - ref) / ref : null };
  } else {
    warnings.push('시세를 가져오지 못했습니다');
  }

  const st = marketStatus(inst.calendarId, now);
  return {
    schemaVersion: 'board/1',
    instrumentId: inst.instrumentId,
    displayName: inst.displayName,
    description: describeMarket(inst, 'spot'),
    demo,
    builtAt: now.toISOString(),
    market: { state: st.state, label: st.label, timezone: st.timezone },
    price,
    chart,
    multi: inst.primaryMarket === 'KRX' ? multiBoard(inst, records, now, warnings) : null,
    warnings,
  };
}

function multiBoard(inst: Instrument, records: readonly SourceRecord[], now: Date, warnings: string[]): MultiBoard {
  const get = (id: string) => records.find((r) => r.id === id);
  const fxRec = get('yahoo.fx.usdkrw');
  const fx = fxRec && fxRec.status !== 'failed' ? { rate: (fxRec.payload as FxPayload).rate, sourceRef: fxRec.id, observedAt: fxRec.observedAt } : null;
  const fxInfo = fx ? { rate: fx.rate, pair: 'USDKRW', sourceRef: fx.sourceRef, observedAt: fx.observedAt } : null;

  const spotRec = get('yahoo.spot.price');
  const spotLast = spotRec && spotRec.status !== 'failed' ? (spotRec.payload as PricePayload).last : null;
  const krxSpot = spotLast !== null && spotRec
    ? { value: spotLast, currency: 'KRW' as const, usd: fx ? spotLast / fx.rate : null, observedAt: spotRec.observedAt }
    : null;

  const funding = get('binance.perp.funding');
  const perps: BoardPerp[] = inst.perpetuals.map((p) => {
    const id = p.exchange === 'binance' && p.primary ? 'binance.perp.price' : `${p.exchange}.perp.price`;
    const rec = get(id);
    const base = { exchange: p.exchange, label: exchangeLabel(p.exchange), symbol: p.symbol };
    if (!rec || rec.status === 'failed') {
      return { ...base, status: 'failed', last: null, mark: null, index: null, fundingRate8h: null, krw: null, observedAt: null, error: rec?.error ?? '조회하지 않음' };
    }
    const pp = rec.payload as PricePayload;
    let krw: number | null = null;
    if (fxInfo && pp.last !== null) {
      const tag: PriceTag = { value: pp.last, currency: 'USDT', marketType: 'perpetual', priceKind: 'last', sourceRef: id, estimated: false };
      krw = convert(tag, 'KRW', fxInfo).value;
    }
    const f = p.exchange === 'binance' && funding && funding.status !== 'failed' ? (funding.payload as FundingPayload).rate8h : null;
    return { ...base, status: 'ok', last: pp.last, mark: pp.mark, index: pp.index, fundingRate8h: f, krw, observedAt: rec.observedAt };
  });

  // 시각이 확인된 가격만 추정에 쓴다 (스냅샷과 같은 규칙)
  const est = estimatePrice(perps.filter((p) => p.status === 'ok' && p.observedAt !== null && p.last !== null).map((p) => ({ exchange: p.exchange, price: p.last! })));
  const estimate: MultiBoard['estimate'] = {
    badge: BOARD_ESTIMATE_BADGE, value: est.value,
    exchanges: est.used.map((u) => exchangeLabel(u.exchange)), excluded: est.excluded.map((u) => exchangeLabel(u.exchange)),
    computedAt: now.toISOString(), ...(est.reason ? { reason: est.reason } : {}),
  };

  let spread: MultiBoard['spread'] = null;
  const bin = perps.find((p) => p.exchange === 'binance');
  if (fxInfo && bin?.last && krxSpot) {
    try {
      const a: PriceTag = { value: bin.last, currency: 'USDT', marketType: 'perpetual', priceKind: 'last', sourceRef: 'binance.perp.price', estimated: false };
      const b: PriceTag = { value: krxSpot.value, currency: 'KRW', marketType: 'spot', priceKind: 'last', sourceRef: 'yahoo.spot.price', estimated: false };
      spread = { value: spreadRatio(convert(a, 'KRW', fxInfo), b), assumptions: ['USDT = USD로 환산', 'KRX 현물은 장 마감 뒤 종가일 수 있음'] };
    } catch (e) {
      warnings.push(`괴리 계산 실패: ${(e as Error).message}`);
    }
  }
  return { fx, krxSpot, perps, estimate, spread };
}
