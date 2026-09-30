// 포지션 컨텍스트 (P2 포지션 명세 0.1, 1.2 R8~R10, 3.2절). 분석 시작 때 한 번 만들어 작업 기록에 고정한다.
// 매칭 키는 (instrumentId, marketType). 같은 종목의 다른 시장 보유는 쓰지 않고 코드가 만든 한 줄만 남긴다.
// notes·otherMarkets·금액은 화면·리포트용이고 모델에는 보내지 않는다 (투영은 Phase 13, P2-4).
import { referencePrice } from '../data/project.ts';
import type { AnalysisSnapshot } from '../data/snapshot.ts';
import type { Currency, MarketType } from '../schema/types.ts';
import { DEFAULT_RISK_PERCENT, equityFor, type Position, type Side } from './book.ts';
import type { BookRead } from './store.ts';

export const STALE_BOOK_HOURS = 24; // P2-1-R9

export type PositionWarning = 'NO_EQUITY' | 'STALE_BOOK' | 'BOOK_INVALID' | 'NO_PRICE';

export interface PositionDerived {
  /** 레버리지 미반영 손익률 %. 롱 (현재가/평단 − 1), 숏 (1 − 현재가/평단) */
  unrealizedPnlPercent: number;
  /** 레버리지 반영 손익률 % (현물은 위와 같음) */
  unrealizedPnlPercentLeveraged: number;
  /** 현재 손익 ÷ 평단~손절 거리. 손절이 없거나 평단과 같으면 null */
  rMultiple: number | null;
  /** 현재가에서 손절까지 불리한 방향 거리 %. 음수면 이미 손절가를 넘음 */
  stopDistancePercent: number | null;
  /** 현재가에서 청산가까지 거리 % (청산가 입력 시) */
  liquidationDistancePercent: number | null;
  /** 수량 × 현재가 ÷ 해당 통화 총 자산 % */
  positionWeightPercent: number | null;
  /** 손절까지 갔을 때 평단 대비 손실 ÷ 총 자산 % (손절이 수익권이면 0) */
  openRiskPercent: number | null;
}

export interface PositionContext {
  schemaVersion: 'position-context/1';
  builtAt: string;
  book: { status: BookRead['status']; updatedAt: string | null; ageHours: number | null; positionCount: number };
  instrumentId: string;
  marketType: MarketType;
  /** 매칭된 포지션 (메모 제외). 없으면 null */
  position: Omit<Position, 'note'> | null;
  account: { currency: Currency; equity: number | null; riskPerTradePercent: number };
  price: { value: number; kind: 'mark' | 'last'; sourceRef: string } | null;
  derived: PositionDerived | null;
  otherMarkets: { marketType: MarketType; side: Side }[];
  warnings: PositionWarning[];
  /** 코드가 만든 화면·리포트 문구 (모델에 보내지 않음) */
  notes: string[];
}

const MARKET_LABEL: Record<MarketType, string> = { spot: '현물', perpetual: '무기한' };
const r2 = (x: number) => Math.round(x * 100) / 100;

export function derive(p: Omit<Position, 'note'>, price: number, equity: number | null): PositionDerived {
  const long = p.side === 'LONG';
  const dir = long ? 1 : -1;
  const pnlPerUnit = (price - p.avgEntryPrice) * dir;
  const pnl = pnlPerUnit / p.avgEntryPrice;
  const stopRiskPerUnit = p.stopLoss === null ? null : (p.avgEntryPrice - p.stopLoss) * dir; // 양수면 손실 구간
  return {
    unrealizedPnlPercent: r2(pnl * 100),
    unrealizedPnlPercentLeveraged: r2(pnl * (p.leverage ?? 1) * 100),
    rMultiple: p.stopLoss === null || p.stopLoss === p.avgEntryPrice ? null : r2(pnlPerUnit / Math.abs(p.avgEntryPrice - p.stopLoss)),
    stopDistancePercent: p.stopLoss === null ? null : r2(((price - p.stopLoss) * dir / price) * 100),
    liquidationDistancePercent: p.liquidationPrice === null ? null : r2(((price - p.liquidationPrice) * dir / price) * 100),
    positionWeightPercent: equity === null ? null : r2((p.quantity * price / equity) * 100),
    openRiskPercent: equity === null || stopRiskPerUnit === null ? null : r2((Math.max(0, stopRiskPerUnit) * p.quantity / equity) * 100),
  };
}

/** P2-1-R8: 작업 시작 때 읽은 북과 스냅샷으로 만든다. 순수 함수 */
export function buildPositionContext(read: BookRead, s: AnalysisSnapshot, now: Date): PositionContext {
  const book = read.status === 'ok' ? read.book : null;
  const ref = referencePrice(s);
  const currency = ref?.currency ?? s.quoteCurrency;
  const equity = book ? equityFor(book, currency) : null;
  const ageHours = book ? Math.max(0, (now.getTime() - Date.parse(book.updatedAt)) / 3_600_000) : null;
  const sameInst = book?.positions.filter((p) => p.instrumentId === s.instrumentId) ?? [];
  const match = sameInst.find((p) => p.marketType === s.marketType);
  const position = match ? (({ note: _n, ...rest }) => rest)(match) : null;
  const otherMarkets = sameInst.filter((p) => p.marketType !== s.marketType).map((p) => ({ marketType: p.marketType, side: p.side }));

  const warnings: PositionWarning[] = [];
  const notes: string[] = [];
  if (read.status === 'invalid') {
    warnings.push('BOOK_INVALID');
    notes.push('포지션 파일에 오류가 있어 보유 정보 없이 분석함 (화면의 포지션 입력에서 확인)');
  }
  if (book && equity === null) warnings.push('NO_EQUITY');
  if (ageHours !== null && ageHours > STALE_BOOK_HOURS) {
    warnings.push('STALE_BOOK');
    notes.push(`보유 정보가 ${Math.floor(ageHours)}시간 전 기준`);
  }
  if (position && !ref) warnings.push('NO_PRICE');
  for (const o of otherMarkets) notes.push(`다른 시장 보유 있음: ${s.displayName} ${MARKET_LABEL[o.marketType]}`);

  return {
    schemaVersion: 'position-context/1',
    builtAt: now.toISOString(),
    book: { status: read.status, updatedAt: book?.updatedAt ?? null, ageHours: ageHours === null ? null : r2(ageHours), positionCount: book?.positions.length ?? 0 },
    instrumentId: s.instrumentId,
    marketType: s.marketType,
    position,
    account: { currency, equity, riskPerTradePercent: book?.account.riskPerTradePercent ?? DEFAULT_RISK_PERCENT },
    price: ref ? { value: ref.value, kind: ref.kind, sourceRef: ref.sourceRef } : null,
    derived: position && ref ? derive(position, ref.value, equity) : null,
    otherMarkets,
    warnings,
    notes,
  };
}
