// 하단 티커 띠: 주요 종목의 현재가·등락률 (표시 전용). 모델·판정·스냅샷에 들어가지 않고, 추정값을 만들지 않는다.
// 공급자는 기존 허용 도메인(Binance 현물, Yahoo Finance)만 쓴다: 새 외부 목적지 없음 (P0-6-R1).
import type { NetClient } from './data/net.ts';

export const TICKER_REFRESH_SECONDS = 30;
/** 주식·지수는 마지막 체결이 이 시간보다 오래되면 마감으로 표시한다 */
const CLOSED_AFTER_MS = 20 * 60_000;

export type TickerGroup = 'coin' | 'us-index' | 'kr-index' | 'kr-stock' | 'us-stock';

interface TickerSpec {
  id: string;
  label: string;
  group: TickerGroup;
  source: 'binance' | 'yahoo';
  /** Binance 심볼 또는 Yahoo 심볼 */
  symbol: string;
  currency: 'USD' | 'KRW' | 'POINT';
}

export const TICKER_ITEMS: readonly TickerSpec[] = [
  { id: 'BTC', label: 'BTC', group: 'coin', source: 'binance', symbol: 'BTCUSDT', currency: 'USD' },
  { id: 'ETH', label: 'ETH', group: 'coin', source: 'binance', symbol: 'ETHUSDT', currency: 'USD' },
  { id: 'SOL', label: 'SOL', group: 'coin', source: 'binance', symbol: 'SOLUSDT', currency: 'USD' },
  { id: 'XRP', label: 'XRP', group: 'coin', source: 'binance', symbol: 'XRPUSDT', currency: 'USD' },
  { id: 'SPX', label: 'S&P500', group: 'us-index', source: 'yahoo', symbol: '^GSPC', currency: 'POINT' },
  { id: 'IXIC', label: 'NASDAQ', group: 'us-index', source: 'yahoo', symbol: '^IXIC', currency: 'POINT' },
  { id: 'DJI', label: 'DOW', group: 'us-index', source: 'yahoo', symbol: '^DJI', currency: 'POINT' },
  { id: 'KOSPI', label: 'KOSPI', group: 'kr-index', source: 'yahoo', symbol: '^KS11', currency: 'POINT' },
  { id: 'KOSDAQ', label: 'KOSDAQ', group: 'kr-index', source: 'yahoo', symbol: '^KQ11', currency: 'POINT' },
  { id: '005930', label: '삼성전자', group: 'kr-stock', source: 'yahoo', symbol: '005930.KS', currency: 'KRW' },
  { id: '000660', label: 'SK하이닉스', group: 'kr-stock', source: 'yahoo', symbol: '000660.KS', currency: 'KRW' },
  { id: '005380', label: '현대차', group: 'kr-stock', source: 'yahoo', symbol: '005380.KS', currency: 'KRW' },
  { id: '373220', label: 'LG에너지솔루션', group: 'kr-stock', source: 'yahoo', symbol: '373220.KS', currency: 'KRW' },
  { id: 'AAPL', label: 'AAPL', group: 'us-stock', source: 'yahoo', symbol: 'AAPL', currency: 'USD' },
  { id: 'MSFT', label: 'MSFT', group: 'us-stock', source: 'yahoo', symbol: 'MSFT', currency: 'USD' },
  { id: 'NVDA', label: 'NVDA', group: 'us-stock', source: 'yahoo', symbol: 'NVDA', currency: 'USD' },
  { id: 'TSLA', label: 'TSLA', group: 'us-stock', source: 'yahoo', symbol: 'TSLA', currency: 'USD' },
  { id: 'AMZN', label: 'AMZN', group: 'us-stock', source: 'yahoo', symbol: 'AMZN', currency: 'USD' },
  { id: 'GOOGL', label: 'GOOGL', group: 'us-stock', source: 'yahoo', symbol: 'GOOGL', currency: 'USD' },
];

export interface TickerItem {
  id: string;
  label: string;
  group: TickerGroup;
  currency: 'USD' | 'KRW' | 'POINT';
  price: number;
  /** 직전 종가(코인은 24시간 전) 대비 변동률, % 단위 */
  changePct: number;
  observedAt: string | null;
  /** 주식·지수가 장 마감·휴장으로 최근 체결이 없는 경우 */
  closed: boolean;
}

export interface Ticker {
  schemaVersion: 'ticker/1';
  demo: boolean;
  builtAt: string;
  items: TickerItem[];
}

function num(x: unknown): number | null {
  const n = typeof x === 'string' ? Number(x) : x;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function item(spec: TickerSpec, price: number, changePct: number, observedAt: string | null, now: Date): TickerItem {
  const stale = spec.group !== 'coin' && (observedAt === null || now.getTime() - Date.parse(observedAt) > CLOSED_AFTER_MS);
  return { id: spec.id, label: spec.label, group: spec.group, currency: spec.currency, price, changePct, observedAt, closed: stale };
}

/** Binance `/api/v3/ticker/24hr?symbols=[…]` 응답 → 항목 (순수) */
export function parseBinance24h(body: string, specs: readonly TickerSpec[], now: Date): TickerItem[] {
  let rows: unknown;
  try { rows = JSON.parse(body); } catch { return []; }
  if (!Array.isArray(rows)) return [];
  const out: TickerItem[] = [];
  for (const spec of specs) {
    const r = rows.find((x) => x && typeof x === 'object' && (x as { symbol?: unknown }).symbol === spec.symbol) as Record<string, unknown> | undefined;
    const price = num(r?.lastPrice);
    const change = num(r?.priceChangePercent);
    if (price === null || change === null || price <= 0) continue;
    const t = num(r?.closeTime);
    out.push(item(spec, price, change, t === null ? null : new Date(t).toISOString(), now));
  }
  return out;
}

/** Yahoo `/v8/finance/chart/<심볼>?interval=1d&range=1d` 응답 → 항목 (순수). 실패하면 null */
export function parseYahooChart(body: string, spec: TickerSpec, now: Date): TickerItem | null {
  let meta: Record<string, unknown> | undefined;
  try { meta = (JSON.parse(body) as { chart?: { result?: { meta?: Record<string, unknown> }[] } }).chart?.result?.[0]?.meta; } catch { return null; }
  const price = num(meta?.regularMarketPrice);
  const prev = num(meta?.chartPreviousClose);
  if (price === null || prev === null || price <= 0 || prev <= 0) return null;
  const t = num(meta?.regularMarketTime);
  return item(spec, price, (price / prev - 1) * 100, t === null ? null : new Date(t * 1000).toISOString(), now);
}

/** 한 번에 모아 온다. 실패한 종목은 빠지고, 전부 실패하면 빈 목록 */
export async function collectTicker(net: NetClient, now: Date): Promise<Ticker> {
  const coins = TICKER_ITEMS.filter((s) => s.source === 'binance');
  const yahoo = TICKER_ITEMS.filter((s) => s.source === 'yahoo');
  const symbols = encodeURIComponent(JSON.stringify(coins.map((s) => s.symbol)));
  const parts = await Promise.all([
    net.get(`https://api.binance.com/api/v3/ticker/24hr?symbols=${symbols}`, 'json')
      .then((r) => parseBinance24h(r.body, coins, now), () => [] as TickerItem[]),
    ...yahoo.map((s) => net.get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s.symbol)}?interval=1d&range=1d`, 'json')
      .then((r) => { const i = parseYahooChart(r.body, s, now); return i ? [i] : []; }, () => [] as TickerItem[])),
  ]);
  const order = new Map(TICKER_ITEMS.map((s, i) => [s.id, i]));
  const items = parts.flat().sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { schemaVersion: 'ticker/1', demo: false, builtAt: now.toISOString(), items };
}

/** 데모 모드: 외부 요청 없이 빈 티커 (P1-8-R2). 화면은 띠를 숨긴다 */
export function demoTicker(now: Date): Ticker {
  return { schemaVersion: 'ticker/1', demo: true, builtAt: now.toISOString(), items: [] };
}
