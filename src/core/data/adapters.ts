// 공급자 어댑터. 모든 요청은 NetClient를 거친다. 실패해도 예외를 던지지 않고 status: 'failed' 기록을 돌려준다.
// 관측 시각은 공급자가 준 값만 쓴다 (P0-4-R2).
import { sessionOn } from './calendar.ts';
import type { Candle } from './candles.ts';
import type { NetClient } from './net.ts';
import type { Instrument, UsQuote } from './registry.ts';
import {
  INTERVAL_SECONDS, type CandlePayload, type EndpointType, type FundamentalsPayload, type FundingPayload, type FxPayload,
  type NewsItem, type NewsPayload, type PricePayload, type SentimentPayload, type SourceRecord,
} from './sources.ts';

const iso = (ms: number | null | undefined): string | null =>
  typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;

export function num(x: unknown): number | null {
  const n = typeof x === 'string' ? Number(x) : x;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function record(
  id: string, provider: string, endpointType: EndpointType, fetchedAt: string,
  payload: unknown, observedAt: string | null, extra: Partial<SourceRecord> = {},
): SourceRecord {
  return { id, provider, endpointType, observedAt, fetchedAt, status: 'ok', estimated: false, untrustedText: false, payload, ...extra };
}

export function failed(id: string, provider: string, endpointType: EndpointType, error: unknown): SourceRecord {
  return {
    id, provider, endpointType, observedAt: null, fetchedAt: new Date().toISOString(), status: 'failed',
    estimated: false, untrustedText: false, payload: null, error: error instanceof Error ? error.message : String(error),
  };
}

/** 한 요청이 여러 소스를 만들 때, 실패하면 모든 id를 failed로 돌려준다 */
async function group(ids: [string, EndpointType][], provider: string, fn: () => Promise<SourceRecord[]>): Promise<SourceRecord[]> {
  try {
    return await fn();
  } catch (e) {
    return ids.map(([id, t]) => failed(id, provider, t, e));
  }
}

async function json(net: NetClient, url: string): Promise<{ data: any; fetchedAt: string }> {
  const r = await net.get(url, 'json');
  try {
    return { data: JSON.parse(r.body), fetchedAt: r.fetchedAt };
  } catch {
    throw new Error(`JSON 파싱 실패: ${new URL(url).host}`);
  }
}

const q = encodeURIComponent;

function binanceKlines(rows: unknown): Candle[] {
  if (!Array.isArray(rows)) throw new Error('klines 형식 오류');
  return rows.map((k: any[]) => ({
    openTime: Number(k[0]), closeTime: Number(k[6]) + 1,
    open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]),
  }));
}

/** 완성 봉 중 마지막 봉의 종료 시각 = 캔들 소스의 관측 시각 */
function lastCompleteEnd(candles: Candle[], fetchedAt: string): string | null {
  const t = Date.parse(fetchedAt);
  const done = candles.filter((c) => c.closeTime <= t);
  return iso(done.at(-1)?.closeTime);
}

// ---------- Binance ----------

export function binanceSpot(net: NetClient, inst: Instrument, withCandles: boolean): Promise<SourceRecord[]> {
  const sym = inst.spot.binance!;
  const ids: [string, EndpointType][] = [['binance.spot.price', 'price'], ['binance.spot.candles.1d', 'candle']];
  return group(ids, 'binance', async () => {
    const t = await json(net, `https://api.binance.com/api/v3/ticker/24hr?symbol=${q(sym)}`);
    const price: PricePayload = { last: num(t.data.lastPrice), mark: null, index: null, currency: 'USDT', marketType: 'spot' };
    const out = [record('binance.spot.price', 'binance', 'price', t.fetchedAt, price, iso(num(t.data.closeTime)))];
    if (withCandles) {
      const k = await json(net, `https://api.binance.com/api/v3/klines?symbol=${q(sym)}&interval=1d&limit=120`);
      const candles = binanceKlines(k.data);
      out.push(record('binance.spot.candles.1d', 'binance', 'candle', k.fetchedAt, { interval: '1d', candles } satisfies CandlePayload,
        lastCompleteEnd(candles, k.fetchedAt), { intervalSeconds: INTERVAL_SECONDS['1d'] }));
    }
    return out;
  });
}

let fundingIntervals: Map<string, number> | null = null;

export function binancePerp(net: NetClient, symbol: string, withCandles: boolean): Promise<SourceRecord[]> {
  const ids: [string, EndpointType][] = [['binance.perp.price', 'price'], ['binance.perp.funding', 'funding'], ['binance.perp.candles.15m', 'candle']];
  return group(ids, 'binance', async () => {
    const [pi, tp] = await Promise.all([
      json(net, `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${q(symbol)}`),
      json(net, `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${q(symbol)}`),
    ]);
    const price: PricePayload = { last: num(tp.data.price), mark: num(pi.data.markPrice), index: num(pi.data.indexPrice), currency: 'USDT', marketType: 'perpetual' };
    const times = [num(pi.data.time), num(tp.data.time)].filter((x): x is number => x !== null);
    const out = [record('binance.perp.price', 'binance', 'price', tp.fetchedAt, price, iso(times.length ? Math.min(...times) : null))];

    if (!fundingIntervals) {
      try {
        const fi = await json(net, 'https://fapi.binance.com/fapi/v1/fundingInfo');
        fundingIntervals = new Map((fi.data as any[]).map((x) => [String(x.symbol), Number(x.fundingIntervalHours)]));
      } catch {
        fundingIntervals = new Map();
      }
    }
    const rate = num(pi.data.lastFundingRate);
    const hours = fundingIntervals.get(symbol) ?? 8; // 목록에 없으면 기본 8시간
    if (rate === null) {
      out.push(failed('binance.perp.funding', 'binance', 'funding', '펀딩비 없음'));
    } else {
      const funding: FundingPayload = { rate, intervalHours: hours, rate8h: (rate * 8) / hours, nextFundingTime: iso(num(pi.data.nextFundingTime)) };
      out.push(record('binance.perp.funding', 'binance', 'funding', pi.fetchedAt, funding, iso(num(pi.data.time))));
    }
    if (withCandles) {
      const k = await json(net, `https://fapi.binance.com/fapi/v1/klines?symbol=${q(symbol)}&interval=15m&limit=150`);
      const candles = binanceKlines(k.data);
      out.push(record('binance.perp.candles.15m', 'binance', 'candle', k.fetchedAt, { interval: '15m', candles } satisfies CandlePayload,
        lastCompleteEnd(candles, k.fetchedAt), { intervalSeconds: INTERVAL_SECONDS['15m'] }));
    }
    return out;
  });
}

/** 테스트용: 펀딩 주기 캐시 초기화 */
export function resetFundingCache(): void {
  fundingIntervals = null;
}

// ---------- 다른 거래소 무기한 (비교·추정용) ----------

export async function otherPerp(net: NetClient, exchange: string, symbol: string): Promise<SourceRecord> {
  const id = `${exchange}.perp.price`;
  try {
    let last: number | null = null;
    let mark: number | null = null;
    let observed: number | null = null;
    let fetchedAt: string;
    if (exchange === 'bybit') {
      const r = await json(net, `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${q(symbol)}`);
      const t = r.data?.result?.list?.[0];
      last = num(t?.lastPrice); mark = num(t?.markPrice); observed = num(r.data?.time); fetchedAt = r.fetchedAt;
    } else if (exchange === 'bitget') {
      const r = await json(net, `https://api.bitget.com/api/v2/mix/market/ticker?productType=USDT-FUTURES&symbol=${q(symbol)}`);
      const t = r.data?.data?.[0];
      last = num(t?.lastPr); mark = num(t?.markPrice); observed = num(t?.ts); fetchedAt = r.fetchedAt;
    } else if (exchange === 'gate') {
      const r = await json(net, `https://api.gateio.ws/api/v4/futures/usdt/tickers?contract=${q(symbol)}`);
      const t = r.data?.[0];
      last = num(t?.last); mark = num(t?.mark_price); fetchedAt = r.fetchedAt; // Gate는 시각을 주지 않음 → 시각 미확인
    } else {
      throw new Error(`지원하지 않는 거래소 ${exchange}`);
    }
    if (last === null) throw new Error('가격 없음');
    const price: PricePayload = { last, mark, index: null, currency: 'USDT', marketType: 'perpetual' };
    return record(id, exchange, 'price', fetchedAt, price, iso(observed));
  } catch (e) {
    return failed(id, exchange, 'price', e);
  }
}

// ---------- Yahoo Finance ----------

export function yahooStock(net: NetClient, inst: Instrument): Promise<SourceRecord[]> {
  const ids: [string, EndpointType][] = [['yahoo.spot.price', 'price'], ['yahoo.spot.candles.1d', 'candle'], ['yahoo.fundamentals', 'fundamentals']];
  return group(ids, 'yahoo', async () => {
    const r = await json(net, `https://query1.finance.yahoo.com/v8/finance/chart/${q(inst.spot.yahoo!)}?interval=1d&range=6mo`);
    const res = r.data?.chart?.result?.[0];
    if (!res) throw new Error(r.data?.chart?.error?.description ?? 'chart 결과 없음');
    const m = res.meta;
    const currency = m.currency === 'KRW' ? 'KRW' : 'USD';
    const price: PricePayload = { last: num(m.regularMarketPrice), mark: null, index: null, currency, marketType: 'spot' };
    const observed = iso((num(m.regularMarketTime) ?? 0) * 1000);

    const ts: number[] = res.timestamp ?? [];
    const quote = res.indicators?.quote?.[0] ?? {};
    const adj: (number | null)[] | undefined = res.indicators?.adjclose?.[0]?.adjclose;
    const cal = inst.calendarId === 'CRYPTO_24_7' ? null : inst.calendarId;
    const candles: Candle[] = [];
    ts.forEach((sec, i) => {
      const o = num(quote.open?.[i]), h = num(quote.high?.[i]), l = num(quote.low?.[i]), c = num(quote.close?.[i]), v = num(quote.volume?.[i]);
      if (o === null || h === null || l === null || c === null) return; // 빈 봉(거래 없음)은 건너뜀
      const openTime = sec * 1000;
      const date = new Date(openTime + (num(m.gmtoffset) ?? 0) * 1000).toISOString().slice(0, 10);
      const session = cal ? sessionOn(cal, date) : null;
      const a = adj ? num(adj[i]) : null;
      candles.push({
        openTime, closeTime: session ? session.close.getTime() : openTime + 6.5 * 3_600_000,
        open: o, high: h, low: l, close: c, volume: v ?? 0, ...(a !== null ? { adjClose: a } : {}),
      });
    });
    const fundamentals: FundamentalsPayload = {
      marketCap: null, volume24h: num(m.regularMarketVolume), fiftyTwoWeekHigh: num(m.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: num(m.fiftyTwoWeekLow), circulatingSupply: null, currency,
    };
    return [
      record('yahoo.spot.price', 'yahoo', 'price', r.fetchedAt, price, observed),
      record('yahoo.spot.candles.1d', 'yahoo', 'candle', r.fetchedAt, { interval: '1d', candles } satisfies CandlePayload,
        lastCompleteEnd(candles, r.fetchedAt), { intervalSeconds: INTERVAL_SECONDS['1d'] }),
      record('yahoo.fundamentals', 'yahoo', 'fundamentals', r.fetchedAt, fundamentals, observed),
    ];
  });
}

export async function yahooFx(net: NetClient): Promise<SourceRecord> {
  try {
    const r = await json(net, 'https://query1.finance.yahoo.com/v8/finance/chart/KRW%3DX?interval=1d&range=5d');
    const m = r.data?.chart?.result?.[0]?.meta;
    const rate = num(m?.regularMarketPrice);
    if (rate === null) throw new Error('환율 없음');
    return record('yahoo.fx.usdkrw', 'yahoo', 'fx', r.fetchedAt, { pair: 'USDKRW', rate } satisfies FxPayload, iso((num(m.regularMarketTime) ?? 0) * 1000));
  } catch (e) {
    return failed('yahoo.fx.usdkrw', 'yahoo', 'fx', e);
  }
}

/** 미국 주식 조회 (P1-2-R5). 레지스트리가 결과를 캐시한다. */
export function yahooUsLookup(net: NetClient) {
  return async (ticker: string): Promise<UsQuote | null> => {
    const r = await json(net, `https://query1.finance.yahoo.com/v1/finance/search?q=${q(ticker)}&quotesCount=5&newsCount=0`);
    const hit = (r.data?.quotes as any[] | undefined)?.find((x) => String(x.symbol).toUpperCase() === ticker);
    return hit ? { symbol: String(hit.symbol), quoteType: String(hit.quoteType), exchange: String(hit.exchange), name: String(hit.shortname ?? hit.longname ?? ticker) } : null;
  };
}

// ---------- CoinGecko, 공포탐욕지수 ----------

export async function coingecko(net: NetClient, inst: Instrument): Promise<SourceRecord> {
  const id = inst.spot.coingecko!;
  try {
    const r = await json(net, `https://api.coingecko.com/api/v3/simple/price?ids=${q(id)}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_last_updated_at=true`);
    const c = r.data?.[id];
    if (!c) throw new Error('코인 정보 없음');
    const f: FundamentalsPayload = {
      marketCap: num(c.usd_market_cap), volume24h: num(c.usd_24h_vol), fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null,
      circulatingSupply: null, currency: 'USD',
    };
    return record('coingecko.fundamentals', 'coingecko', 'fundamentals', r.fetchedAt, f, iso((num(c.last_updated_at) ?? 0) * 1000));
  } catch (e) {
    return failed('coingecko.fundamentals', 'coingecko', 'fundamentals', e);
  }
}

export async function fearGreed(net: NetClient): Promise<SourceRecord> {
  try {
    const r = await json(net, 'https://api.alternative.me/fng/?limit=1');
    const d = r.data?.data?.[0];
    const value = num(d?.value);
    if (value === null) throw new Error('지수 없음');
    return record('feargreed.alternative', 'alternative.me', 'sentiment', r.fetchedAt,
      { value, classification: String(d.value_classification ?? '') } satisfies SentimentPayload, iso((num(d.timestamp) ?? 0) * 1000));
  } catch (e) {
    return failed('feargreed.alternative', 'alternative.me', 'sentiment', e);
  }
}

// ---------- 뉴스 RSS (불신 텍스트) ----------

export const NEWS_LIMITS = { maxItems: 10, maxTitle: 200, maxSummary: 300, maxAgeHours: 72 } as const;

/** P1-7-R10: 태그·제어 문자 제거, 엔티티 해제, 길이 제한 */
export function sanitizeText(s: string, max: number): string {
  const decoded = s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => safeChar(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/<[^>]*>/g, ' '); // 엔티티 해제 뒤 드러난 태그도 제거
  // eslint-disable-next-line no-control-regex
  const clean = decoded.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
}

function safeChar(code: number): string {
  return Number.isFinite(code) && code > 31 && code < 0x10ffff ? String.fromCodePoint(code) : ' ';
}

export function parseRss(xml: string, now: Date): NewsItem[] {
  const items: NewsItem[] = [];
  for (const m of xml.matchAll(/<item\b[\s\S]*?<\/item>/g)) {
    const block = m[0];
    const tag = (name: string) => block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? null;
    const pub = Date.parse(sanitizeText(tag('pubDate') ?? '', 64));
    if (!Number.isFinite(pub)) continue;
    if (now.getTime() - pub > NEWS_LIMITS.maxAgeHours * 3_600_000) continue; // 72시간 넘으면 제외 (P0 명세 4.4)
    const source = tag('source');
    let title = sanitizeText(tag('title') ?? '', NEWS_LIMITS.maxTitle + 80);
    const src = source ? sanitizeText(source, 80) : null;
    if (src && title.endsWith(` - ${src}`)) title = title.slice(0, -(src.length + 3)); // Google 뉴스 제목 끝의 " - 출처" 제거
    if (!title) continue;
    items.push({ title: sanitizeText(title, NEWS_LIMITS.maxTitle), source: src, publishedAt: new Date(pub).toISOString(), summary: null });
  }
  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return items.slice(0, NEWS_LIMITS.maxItems);
}

export async function googleNews(net: NetClient, inst: Instrument, now: Date): Promise<SourceRecord> {
  const { query, lang } = inst.news;
  const locale = lang === 'ko' ? 'hl=ko&gl=KR&ceid=KR:ko' : 'hl=en-US&gl=US&ceid=US:en';
  try {
    const r = await net.get(`https://news.google.com/rss/search?q=${q(query)}&${locale}`, 'xml');
    const items = parseRss(r.body, now);
    return record('news.google', 'google-news', 'news', r.fetchedAt, { items } satisfies NewsPayload, items[0]?.publishedAt ?? null, { untrustedText: true });
  } catch (e) {
    return { ...failed('news.google', 'google-news', 'news', e), untrustedText: true };
  }
}
