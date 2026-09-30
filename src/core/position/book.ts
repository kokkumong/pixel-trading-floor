// 포지션 북 스키마와 검증 (P2 포지션 명세 1장). 화면 폼과 손으로 고친 파일이 같은 검증을 받는다 (P2-1-R1·R2).
// 청산가는 사용자가 옮겨 적은 값만 쓰고 앱이 계산하지 않는다 (P2-1-R6).
import { randomUUID } from 'node:crypto';
import { arr, en, int, nul, num, obj, parse, str, type Infer, type SchemaError } from '../schema/dsl.ts';
import { CURRENCIES, MARKET_TYPES, type Currency } from '../schema/types.ts';

export const BOOK_SCHEMA_VERSION = 'positions/1';
export const MAX_POSITIONS = 50;
export const DEFAULT_RISK_PERCENT = 1; // D20
export const MAX_LEVERAGE = 20;
export const MAX_NOTE = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const positive = () => num({ exclusiveMin: 0 });

const positionSchema = obj({
  id: str({ pattern: UUID }),
  instrumentId: str({ minLength: 1, maxLength: 40 }),
  marketType: en(MARKET_TYPES),
  side: en(['LONG', 'SHORT'] as const),
  avgEntryPrice: positive(),
  quantity: positive(),
  leverage: nul(int({ min: 1, max: MAX_LEVERAGE })),
  marginMode: nul(en(['isolated', 'cross'] as const)),
  liquidationPrice: nul(positive()),
  stopLoss: nul(positive()),
  targets: arr(positive(), { maxItems: 3 }),
  openedAt: nul(str({ pattern: ISO })),
  note: str({ maxLength: MAX_NOTE }),
});

const bookSchema = obj({
  schemaVersion: en([BOOK_SCHEMA_VERSION] as const),
  updatedAt: str({ pattern: ISO }),
  account: obj({
    equity: obj({ KRW: nul(positive()), USD: nul(positive()), USDT: nul(positive()) }),
    riskPerTradePercent: num({ min: 0.1, max: 5 }),
  }),
  positions: arr(positionSchema, { maxItems: MAX_POSITIONS }),
});

export type Position = Infer<typeof positionSchema>;
export type PositionBook = Infer<typeof bookSchema>;
export type Side = Position['side'];

export interface BookError {
  path: string;
  message: string;
}

export type BookCheck = { ok: true; book: PositionBook } | { ok: false; errors: BookError[] };

export function emptyBook(now: Date): PositionBook {
  return {
    schemaVersion: BOOK_SCHEMA_VERSION,
    updatedAt: now.toISOString(),
    account: { equity: { KRW: null, USD: null, USDT: null }, riskPerTradePercent: DEFAULT_RISK_PERCENT },
    positions: [],
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 빠진 선택 필드만 기본값으로 채운다 (값이 잘못된 필드는 그대로 두어 검증에서 걸린다). 새 포지션에 id를 준다 */
function withDefaults(raw: unknown, newId: () => string): unknown {
  if (!isObj(raw)) return raw;
  const account = isObj(raw.account) ? raw.account : {};
  const equity = isObj(account.equity) ? account.equity : account.equity === undefined ? {} : account.equity;
  return {
    ...raw,
    schemaVersion: raw.schemaVersion ?? BOOK_SCHEMA_VERSION,
    account: {
      ...account,
      equity: isObj(equity) ? Object.fromEntries(CURRENCIES.map((c) => [c, equity[c] ?? null])) : equity,
      riskPerTradePercent: account.riskPerTradePercent ?? DEFAULT_RISK_PERCENT,
    },
    positions: Array.isArray(raw.positions)
      ? raw.positions.map((p) => isObj(p) ? {
        leverage: null, marginMode: null, liquidationPrice: null, stopLoss: null, targets: [], openedAt: null, note: '',
        ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)),
        id: p.id ?? newId(),
      } : p)
      : raw.positions,
  };
}

/**
 * P2-1-R2·R3: 스키마 + 교차 필드 규칙. isKnown은 레지스트리 확인 (미국 종목은 호출하는 쪽이 조회 후 판단).
 * 오류는 필드 경로별로 모두 모아 돌려준다 (저장하지 않는다).
 */
export function validateBook(raw: unknown, isKnown: (instrumentId: string) => boolean, newId: () => string = randomUUID): BookCheck {
  const parsed = parse(bookSchema, withDefaults(raw, newId));
  if (!parsed.ok) return { ok: false, errors: parsed.errors.map(toBookError) };
  const book = parsed.value;
  const errors: BookError[] = [];
  const seen = new Map<string, number>();
  const ids = new Set<string>();
  book.positions.forEach((p, i) => {
    const at = (f: string) => `$.positions[${i}].${f}`;
    if (!isKnown(p.instrumentId)) errors.push({ path: at('instrumentId'), message: `등록되지 않은 종목: ${p.instrumentId}` });
    if (p.marketType === 'spot') {
      if (p.side !== 'LONG') errors.push({ path: at('side'), message: '현물은 롱(LONG)만 입력할 수 있습니다' });
      if (p.leverage !== null) errors.push({ path: at('leverage'), message: '현물에는 레버리지를 넣지 않습니다' });
      if (p.marginMode !== null) errors.push({ path: at('marginMode'), message: '현물에는 마진 방식을 넣지 않습니다' });
      if (p.liquidationPrice !== null) errors.push({ path: at('liquidationPrice'), message: '현물에는 청산가가 없습니다' });
    } else if (p.leverage === null) {
      errors.push({ path: at('leverage'), message: `무기한 선물은 레버리지(1~${MAX_LEVERAGE} 정수)가 필요합니다` });
    }
    if (p.liquidationPrice !== null) {
      if (p.side === 'LONG' && !(p.liquidationPrice < p.avgEntryPrice)) errors.push({ path: at('liquidationPrice'), message: '롱의 청산가는 평균 진입가보다 낮아야 합니다' });
      if (p.side === 'SHORT' && !(p.liquidationPrice > p.avgEntryPrice)) errors.push({ path: at('liquidationPrice'), message: '숏의 청산가는 평균 진입가보다 높아야 합니다' });
    }
    const key = `${p.instrumentId}|${p.marketType}`;
    const dup = seen.get(key);
    if (dup !== undefined) errors.push({ path: at('instrumentId'), message: `같은 종목·시장 포지션이 이미 있습니다 (${dup + 1}번째). 헤지는 지원하지 않습니다` });
    else seen.set(key, i);
    if (ids.has(p.id)) errors.push({ path: at('id'), message: '중복된 id' });
    ids.add(p.id);
  });
  return errors.length ? { ok: false, errors } : { ok: true, book };
}

function toBookError(e: SchemaError): BookError {
  return { path: e.path, message: e.message };
}

/** 대상 종목 통화의 총 자산 (P2-1-R4: 환율 환산 없음) */
export function equityFor(book: PositionBook, currency: Currency): number | null {
  return book.account.equity[currency] ?? null;
}
