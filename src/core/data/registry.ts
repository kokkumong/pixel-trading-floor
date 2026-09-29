// 종목 입력 검증과 정규화 (P1-7-R1, P1-2.2), InstrumentRegistry (P1-2.1, P1-2.3).
// 부분 일치·유사도·오타 교정으로 종목을 고르지 않는다. 후보는 제안만 한다 (P1-2-R3).
import type { Currency, MarketType, Mode } from '../schema/types.ts';
import registryData from './registry.json' with { type: 'json' };

export type CalendarId = 'KRX' | 'US' | 'CRYPTO_24_7';

export interface PerpetualListing {
  exchange: string;
  symbol: string;
  quoteCurrency: Currency;
  contractMultiplier: number | null;
  tickSize: number | null;
  primary: boolean;
}

export interface Instrument {
  instrumentId: string;
  displayName: string;
  aliases: string[];
  assetClass: 'equity' | 'crypto';
  primaryMarket: 'KRX' | 'NASDAQ' | 'NYSE' | 'NYSE American' | 'NYSE Arca' | 'CRYPTO';
  timezone: string;
  calendarId: CalendarId;
  primaryCurrency: Currency;
  spot: { binance?: string; coingecko?: string; yahoo?: string };
  perpetuals: PerpetualListing[];
  news: { query: string; lang: 'ko' | 'en' };
  supportedModes: Mode[];
}

export interface RegistryData {
  registryVersion: string;
  instruments: Instrument[];
}

export const MAX_INPUT_LENGTH = 32;
const ALLOWED = /^[\p{Script=Hangul}A-Za-z0-9 .\-]+$/u;
const US_TICKER = /^[A-Z]{1,5}(\.[A-Z])?$/;

export type InputCheck = { ok: true; normalized: string } | { ok: false; message: string };

/** P1-7-R1: 길이와 허용 문자를 정규화 전에 검사한 뒤, 공백 제거·NFC·영문 대문자화 (P1-2.2 1~2단계). */
export function normalizeSymbolInput(raw: unknown): InputCheck {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, message: '종목을 입력하세요' };
  if (raw.length > MAX_INPUT_LENGTH) return { ok: false, message: `종목 입력은 최대 ${MAX_INPUT_LENGTH}자입니다` };
  if (!ALLOWED.test(raw)) return { ok: false, message: '종목 입력에는 한글, 영문, 숫자, -, ., 공백만 쓸 수 있습니다' };
  const normalized = raw.trim().normalize('NFC').toUpperCase();
  if (normalized.length === 0) return { ok: false, message: '종목을 입력하세요' };
  return { ok: true, normalized };
}

export interface Candidate {
  instrumentId: string;
  displayName: string;
}

export type Resolution =
  | { ok: true; instrument: Instrument; marketType: MarketType; description: string }
  | {
      ok: false;
      code: 'E-UNSUPPORTED-SYMBOL';
      reason: 'INVALID_INPUT' | 'NOT_FOUND' | 'MODE_NOT_SUPPORTED';
      message: string;
      candidates: Candidate[];
    };

/** 미국 주식 조회 결과 (Yahoo search의 quoteType·exchange 코드) */
export interface UsQuote {
  symbol: string;
  quoteType: string;
  exchange: string;
  name: string;
}
export type UsLookup = (ticker: string) => Promise<UsQuote | null>;

// P1-2-R5: NASDAQ·NYSE·NYSE American·NYSE Arca만. Yahoo 거래소 코드 → 시장 이름
const US_EXCHANGES: Record<string, Instrument['primaryMarket']> = {
  NMS: 'NASDAQ', NGM: 'NASDAQ', NCM: 'NASDAQ', NYQ: 'NYSE', ASE: 'NYSE American', PCX: 'NYSE Arca',
};
const US_TYPES = new Set(['EQUITY', 'ETF']);

export class InstrumentRegistry {
  readonly version: string;
  private readonly byAlias = new Map<string, Instrument>();
  private readonly byId = new Map<string, Instrument>();
  private readonly usCache = new Map<string, Instrument | null>();

  constructor(data: RegistryData = registryData as RegistryData) {
    this.version = data.registryVersion;
    for (const inst of data.instruments) {
      this.byId.set(inst.instrumentId, inst);
      for (const alias of inst.aliases) {
        const key = alias.normalize('NFC').toUpperCase();
        const prev = this.byAlias.get(key);
        if (prev && prev !== inst) throw new Error(`레지스트리 별칭 충돌: ${alias} (${prev.instrumentId}, ${inst.instrumentId})`);
        this.byAlias.set(key, inst);
      }
    }
  }

  get(instrumentId: string): Instrument | undefined {
    return this.byId.get(instrumentId) ?? this.usCache.get(instrumentId.replace(/^US:/, '')) ?? undefined;
  }

  all(): Instrument[] {
    return [...this.byId.values()];
  }

  /** 레지스트리 별칭 정확 일치만으로 해석한다 (미국 주식 조회 없음). */
  resolve(raw: unknown, mode: Mode): Resolution {
    const input = normalizeSymbolInput(raw);
    if (!input.ok) return fail('INVALID_INPUT', input.message, []);
    const inst = this.byAlias.get(input.normalized);
    if (!inst) return fail('NOT_FOUND', '지원하지 않는 종목입니다', this.candidates(input.normalized));
    return this.withMode(inst, mode);
  }

  /** P1-2.2 4단계까지: 별칭에 없고 미국 주식 형식이면 공급자 조회로 받는다. */
  async resolveWithLookup(raw: unknown, mode: Mode, lookup: UsLookup): Promise<Resolution> {
    const first = this.resolve(raw, mode);
    if (first.ok || first.reason !== 'NOT_FOUND') return first;
    const ticker = (normalizeSymbolInput(raw) as { normalized: string }).normalized;
    if (!US_TICKER.test(ticker)) return first;
    let inst = this.usCache.get(ticker);
    if (inst === undefined) {
      const q = await lookup(ticker);
      inst = q && q.symbol.toUpperCase() === ticker && US_TYPES.has(q.quoteType) && US_EXCHANGES[q.exchange]
        ? usInstrument(ticker, q)
        : null;
      this.usCache.set(ticker, inst);
    }
    return inst ? this.withMode(inst, mode) : first;
  }

  private withMode(inst: Instrument, mode: Mode): Resolution {
    if (!inst.supportedModes.includes(mode)) {
      return fail('MODE_NOT_SUPPORTED', '이 종목은 알고리즘 모드만 지원합니다', [{ instrumentId: inst.instrumentId, displayName: inst.displayName }]);
    }
    const marketType: MarketType = mode === 'algorithm' ? 'spot' : 'perpetual';
    return { ok: true, instrument: inst, marketType, description: describeMarket(inst, marketType) };
  }

  /** 부분 일치 후보 (제안 전용, 최대 5개) */
  private candidates(input: string): Candidate[] {
    if (input.length < 2) return [];
    const out = new Map<string, Candidate>();
    for (const [alias, inst] of this.byAlias) {
      if (alias.includes(input) || (input.length >= 3 && input.includes(alias) && alias.length >= 3)) {
        out.set(inst.instrumentId, { instrumentId: inst.instrumentId, displayName: inst.displayName });
      }
      if (out.size >= 5) break;
    }
    return [...out.values()];
  }
}

function fail(reason: 'INVALID_INPUT' | 'NOT_FOUND' | 'MODE_NOT_SUPPORTED', message: string, candidates: Candidate[]): Resolution {
  return { ok: false, code: 'E-UNSUPPORTED-SYMBOL', reason, message, candidates };
}

function usInstrument(ticker: string, q: UsQuote): Instrument {
  return {
    instrumentId: `US:${ticker}`,
    displayName: `${q.name || ticker} (${ticker})`,
    aliases: [ticker],
    assetClass: 'equity',
    primaryMarket: US_EXCHANGES[q.exchange]!,
    timezone: 'America/New_York',
    calendarId: 'US',
    primaryCurrency: 'USD',
    spot: { yahoo: ticker.replace('.', '-') },
    perpetuals: [],
    news: { query: `${ticker} stock`, lang: 'en' },
    supportedModes: ['algorithm'], // P1-2-R6
  };
}

/** P1-2-R4: 분석 시작 전에 보여줄 해석 결과 */
export function describeMarket(inst: Instrument, marketType: MarketType): string {
  if (marketType === 'perpetual') {
    const p = inst.perpetuals.find((x) => x.primary);
    return `${inst.displayName} · ${exchangeLabel(p?.exchange ?? '?')} ${p?.quoteCurrency ?? 'USDT'} 무기한`;
  }
  if (inst.assetClass === 'crypto') return `${inst.displayName} · Binance 현물 · ${inst.primaryCurrency}`;
  return `${inst.displayName} · ${inst.primaryMarket} 현물 · ${inst.primaryCurrency}`;
}

export function exchangeLabel(id: string): string {
  return ({ binance: 'Binance', bybit: 'Bybit', bitget: 'Bitget', gate: 'Gate' } as Record<string, string>)[id] ?? id;
}
