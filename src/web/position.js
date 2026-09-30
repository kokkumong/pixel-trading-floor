// @ts-check
// 포지션 입력 화면의 표시 모델 (순수 함수, P2-1-R1·R7·R9). DOM을 만지지 않으며 node --test로 검증한다 (test/web/position.test.ts).
// 검증은 서버가 한다 (P2-1-R2). 여기서는 폼 글자를 PUT 본문으로 옮기고, 400 응답의 errors[].path를 필드에 붙인다.
// 이 화면은 로컬 전용이다 (/api/positions는 LAN에 403, P2-1-R11). 메모 등 사용자 글자는 textContent로만 넣는다.
import { fmtChange, fmtPrice } from './model.js';

/** @typedef {'algorithm' | 'scalp' | 'forced_direction'} Mode */
/** @typedef {'spot' | 'perpetual'} MarketType */

export const MARKET_LABEL = /** @type {const} */ ({ spot: '현물', perpetual: '무기한' });
export const SIDE_LABEL = /** @type {const} */ ({ LONG: '롱', SHORT: '숏' });
export const STALE_BOOK_HOURS = 24; // P2-1-R9 (서버 context.ts와 같은 값)
export const MAX_TARGETS = 3;

/**
 * @typedef {{ symbol: string; origSymbol: string; marketType: string; side: string; avgEntryPrice: string; quantity: string;
 *   leverage: string; marginMode: string; liquidationPrice: string; stopLoss: string; targets: string; note: string }} PositionForm
 * @typedef {{ KRW: string; USD: string; USDT: string; risk: string }} AccountForm
 */

/** @returns {PositionForm} */
export function emptyForm() {
  return { symbol: '', origSymbol: '', marketType: 'spot', side: 'LONG', avgEntryPrice: '', quantity: '', leverage: '', marginMode: '', liquidationPrice: '', stopLoss: '', targets: '', note: '' };
}

/** @param {any} p 저장된 포지션 @param {string} name 표시 이름 @returns {PositionForm} */
export function positionToForm(p, name) {
  const s = (/** @type {number | null} */ v) => (v === null || v === undefined ? '' : String(v));
  return {
    symbol: name, origSymbol: name, marketType: p.marketType, side: p.side, avgEntryPrice: s(p.avgEntryPrice), quantity: s(p.quantity),
    leverage: s(p.leverage), marginMode: p.marginMode ?? '', liquidationPrice: s(p.liquidationPrice), stopLoss: s(p.stopLoss),
    targets: (p.targets ?? []).join(', '), note: p.note ?? '',
  };
}

/** 빈칸은 null, 천 단위 쉼표는 지운다. 숫자가 아니면 글자 그대로 보내 서버가 필드 오류로 거절한다 @param {string} raw */
function num(raw) {
  const t = raw.trim().replace(/,/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : raw.trim();
}

/** 목표가: 공백·`/`로, 또는 뒤에 세 자리 숫자가 오지 않는 쉼표로 나눈다 (`55,000 / 52,000`, `55000, 52000`) @param {string} raw */
function targetList(raw) {
  return raw.split(/[\s/]+|,(?!\d{3}(?:\D|$))/).map((t) => t.trim()).filter((t) => t !== '').map(num);
}

/**
 * 폼 → PUT 본문의 포지션 한 건. 새 포지션·종목을 바꾼 포지션은 `symbol`로 보내 서버가 해석한다
 * @param {PositionForm} f @param {any} prev 수정 중인 기존 포지션 (새로 추가면 null)
 * @returns {Record<string, any>}
 */
export function formToPosition(f, prev) {
  const spot = f.marketType === 'spot';
  const symbol = f.symbol.trim();
  /** @type {Record<string, any>} */
  const out = prev
    ? symbol === f.origSymbol ? { id: prev.id, instrumentId: prev.instrumentId } : { id: prev.id, symbol }
    : { symbol };
  return {
    ...out,
    marketType: f.marketType,
    side: spot ? 'LONG' : f.side,
    avgEntryPrice: num(f.avgEntryPrice),
    quantity: num(f.quantity),
    leverage: spot ? null : num(f.leverage),
    marginMode: spot || f.marginMode === '' ? null : f.marginMode,
    liquidationPrice: spot ? null : num(f.liquidationPrice),
    stopLoss: num(f.stopLoss),
    targets: targetList(f.targets),
    openedAt: prev?.openedAt ?? null,
    note: f.note.trim(),
  };
}

/** @param {any} book */
export function accountToForm(book) {
  const s = (/** @type {number | null} */ v) => (v === null || v === undefined ? '' : String(v));
  const e = book.account.equity;
  return { KRW: s(e.KRW), USD: s(e.USD), USDT: s(e.USDT), risk: s(book.account.riskPerTradePercent) };
}

/**
 * PUT 본문 = 북 전체 교체. updatedAt은 서버 시각으로 정하므로 보내지 않는다
 * @param {any} book @param {AccountForm} acct @param {Record<string, any>[]} positions
 */
export function bookPayload(book, acct, positions) {
  return {
    schemaVersion: book.schemaVersion,
    account: { equity: { KRW: num(acct.KRW), USD: num(acct.USD), USDT: num(acct.USDT) }, riskPerTradePercent: num(acct.risk) ?? 1 },
    positions,
  };
}

/**
 * 400 응답의 errors[].path를 폼 필드에 붙인다. 편집 중인 포지션(index)의 오류와 계좌 오류는 필드 옆, 나머지는 목록으로
 * @param {{ path: string; message: string }[]} errors @param {number | null} index
 * @returns {{ fields: Record<string, string>; other: string[] }}
 */
export function fieldErrors(errors, index) {
  /** @type {Record<string, string>} */
  const fields = {};
  /** @type {string[]} */
  const other = [];
  const put = (/** @type {string} */ k, /** @type {string} */ m) => { if (!(k in fields)) fields[k] = m; };
  for (const e of errors) {
    const pos = /^\$\.positions\[(\d+)\]\.(\w+)/.exec(e.path);
    const eq = /^\$\.account\.equity\.(KRW|USD|USDT)\b/.exec(e.path);
    const field = pos?.[2] ?? '';
    if (pos && Number(pos[1]) === index) put(field === 'instrumentId' ? 'symbol' : field, e.message);
    else if (pos) other.push(`${Number(pos[1]) + 1}번 포지션 · ${field}: ${e.message}`);
    else if (eq) put(eq[1] ?? '', e.message);
    else if (e.path.startsWith('$.account.riskPerTradePercent')) put('risk', e.message);
    else other.push(`${e.path}: ${e.message}`);
  }
  return { fields, other };
}

/** 종목 번호 앞부분으로 통화를 정한다 (표시용) @param {string} instrumentId */
function currencyOf(instrumentId) {
  return instrumentId.startsWith('KR:') ? 'KRW' : 'USD';
}

/** 평단 대비 손익률 (숏은 1 − 현재가/평단, 서버 context.ts와 같은 정의) @param {any} p @param {number} price */
function pnlRatio(p, price) {
  return p.side === 'LONG' ? price / p.avgEntryPrice - 1 : 1 - price / p.avgEntryPrice;
}

/** @param {any} view @param {number} nowMs */
function ageHours(view, nowMs) {
  const t = Date.parse(view.book.updatedAt);
  return Number.isFinite(t) ? (nowMs - t) / 3_600_000 : null;
}

/**
 * P2-1-R7 상단 요약: 종목·방향·평단, 전광판 종목과 같으면 현재가 기준 수익률, 마지막 갱신
 * @param {any} view /api/positions 응답 @param {any} board /api/board 응답 @param {number} nowMs
 * @returns {{ updated: string; empty: string; rows: { text: string; tone: '' | 'up' | 'down' }[] }}
 */
export function summaryRows(view, board, nowMs) {
  const updated = view.status === 'missing' ? '입력한 적 없음' : view.status === 'invalid' ? '포지션 파일 오류' : ago(ageHours(view, nowMs));
  const rows = view.book.positions.map((/** @type {any} */ p) => {
    const cur = board?.instrumentId === p.instrumentId && board.price ? board.price.currency : currencyOf(p.instrumentId);
    let text = `${view.names[p.instrumentId] ?? p.instrumentId} ${MARKET_LABEL[/** @type {MarketType} */ (p.marketType)]} ${SIDE_LABEL[/** @type {'LONG' | 'SHORT'} */ (p.side)]} · 평단 ${fmtPrice(p.avgEntryPrice, cur)}`;
    /** @type {'' | 'up' | 'down'} */
    let tone = '';
    if (board?.instrumentId === p.instrumentId && board.price) {
      const r = pnlRatio(p, board.price.value);
      text += ` · ${fmtChange(r)}`;
      tone = r > 0 ? 'up' : r < 0 ? 'down' : '';
    }
    return { text, tone };
  });
  return { updated, empty: rows.length === 0 ? '보유 포지션 없음' : '', rows };
}

/** @param {number | null} h */
function ago(h) {
  if (h === null) return '';
  if (h < 1) return `${Math.max(0, Math.floor(h * 60))}분 전 갱신`;
  return `${Math.floor(h)}시간 전 갱신`;
}

/**
 * P2-1-R7 분석 버튼 옆: 대상 종목의 보유 (모드가 정하는 시장 기준, 알고리즘=현물·그 외=무기한). LAN·못 읽음이면 빈 글자
 * @param {any} view @param {any} board @param {Mode} mode
 */
export function holdingLabel(view, board, mode) {
  if (!view || !board) return '';
  if (mode === 'forced_direction') return '강제 방향은 보유를 반영하지 않음';
  if (view.status === 'invalid') return '포지션 파일 오류 · 보유 없이 분석됨';
  const target = mode === 'algorithm' ? 'spot' : 'perpetual';
  const same = view.book.positions.filter((/** @type {any} */ p) => p.instrumentId === board.instrumentId);
  const label = (/** @type {any} */ p) => `${MARKET_LABEL[/** @type {MarketType} */ (p.marketType)]} ${SIDE_LABEL[/** @type {'LONG' | 'SHORT'} */ (p.side)]}`;
  const match = same.find((/** @type {any} */ p) => p.marketType === target);
  if (match) return `보유: ${label(match)} · 평단 ${fmtPrice(match.avgEntryPrice, board.price?.currency ?? currencyOf(match.instrumentId))}`;
  const others = same.map(label);
  return others.length ? `보유 없음 · 다른 시장 보유 있음: ${others.join(', ')}` : '보유 없음';
}

/** P2-1-R9 시작 화면 경고. 파일이 없거나 못 읽으면 null @param {any} view @param {number} nowMs */
export function staleWarning(view, nowMs) {
  if (!view || view.status !== 'ok') return null;
  const h = ageHours(view, nowMs);
  return h !== null && h > STALE_BOOK_HOURS ? `보유 정보가 ${Math.floor(h)}시간 전 기준` : null;
}
