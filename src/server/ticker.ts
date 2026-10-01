// 하단 티커의 서버 쪽 (GET /api/ticker). 한 번의 조회를 모든 접속이 30초 동안 나눠 쓴다. 데모는 네트워크를 쓰지 않는다 (P1-8-R2).
import { collectTicker, demoTicker, TICKER_REFRESH_SECONDS, type Ticker } from '../core/ticker.ts';
import { createRealNet, type NetClient } from '../core/data/net.ts';

export interface TickerServiceOptions {
  net?: NetClient;
  now?: () => Date;
  ttlMs?: number;
}

export class TickerService {
  private readonly o: TickerServiceOptions;
  private readonly net: NetClient;
  private readonly now: () => Date;
  private cache: { at: number; ticker: Promise<Ticker> } | null = null;

  constructor(o: TickerServiceOptions = {}) {
    this.o = o;
    this.net = o.net ?? createRealNet();
    this.now = o.now ?? (() => new Date());
  }

  async get(demo: boolean): Promise<Ticker> {
    if (demo) return demoTicker(this.now());
    const t = this.now().getTime();
    if (this.cache && t - this.cache.at < (this.o.ttlMs ?? TICKER_REFRESH_SECONDS * 1000)) return this.cache.ticker;
    const ticker = collectTicker(this.net, this.now());
    this.cache = { at: t, ticker };
    ticker.catch(() => { this.cache = null; });
    return ticker;
  }
}
