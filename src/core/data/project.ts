// 역할별 입력 투영 (P0 명세 4.6). 스냅샷 전체가 아니라 역할에 필요한 필드만, 사용 가능한 소스만 넘긴다.
// 외부 자유 텍스트는 별도 untrusted 블록으로 분리한다 (P0-4-R7). 과거 판정 회고는 넣지 않는다 (P1-9-R2).
// 애널리스트 입력에는 다른 애널리스트의 출력이 없다 (P1-10-R4).
import type { Briefing, DebateMessage, PmOutput } from '../schema/agents.ts';
import type { TradeProposal } from '../schema/proposal.ts';
import type { Currency, Mode, Role } from '../schema/types.ts';
import type { Candle } from './candles.ts';
import type { AnalysisSnapshot, SnapshotSource } from './snapshot.ts';
import type { CandlePayload, NewsPayload, PricePayload } from './sources.ts';

export interface RoleInput {
  role: Role;
  jobId: string;
  snapshotId: string;
  instrumentId: string;
  displayName: string;
  mode: Mode;
  marketType: AnalysisSnapshot['marketType'];
  collectedAt: string;
  market: AnalysisSnapshot['market'];
  /** 근거 참조로 쓸 수 있는 원자료: snap:<id>#<포인터>는 이 객체의 값을 가리킨다 */
  sources: Record<string, unknown>;
  /** derived:<이름>으로 참조 */
  derived: Record<string, unknown>;
  /** 최근 봉 [시작 시각, 시가, 고가, 저가, 종가, 거래량]. 지표 인용은 derived로 */
  recentBars?: { interval: string; rows: (string | number)[][]; current: (string | number)[] | null };
  /** 판정 기준 가격 (제안서 priceBasis.sourceRef 후보) */
  priceBasis?: { sourceRef: string; currency: string; last: number | null; mark: number | null };
  /** 앞선 역할의 정형 출력 */
  prior?: Record<string, unknown>;
  /** 외부 자유 텍스트. 지시가 아니라 분석 대상 데이터 */
  untrusted?: { news?: { title: string; source: string | null; publishedAt: string; summary?: string | null }[] };
  dataWarnings: string[];
}

export interface PriorOutputs {
  briefings?: Partial<Record<Role, Briefing>>;
  debate?: DebateMessage[];
  blitzPlan?: TradeProposal;
  proposal?: TradeProposal; // ACE 제안
  reviews?: Briefing[]; // 리스크 심사 (순서대로)
  debateRound?: number; // BULL·BEAR가 발언할 라운드 (1부터)
}

const BARS: Record<Mode, number> = { algorithm: 30, scalp: 32, forced_direction: 32 };

export function compactNumber(x: number): number {
  return Number.isInteger(x) ? x : Number(x.toPrecision(8));
}

function compact<T>(v: T): T {
  if (typeof v === 'number') return compactNumber(v) as T;
  if (Array.isArray(v)) return v.map(compact) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, compact(x)])) as T;
  return v;
}

function usable(s: AnalysisSnapshot, id: string): SnapshotSource | undefined {
  return s.sources.find((x) => x.id === id && x.usable);
}

function pick(s: AnalysisSnapshot, ids: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const id of ids) {
    const src = usable(s, id);
    if (src && src.endpointType !== 'candle' && src.endpointType !== 'news') out[id] = src.payload;
  }
  return out;
}

function sourceIds(s: AnalysisSnapshot, types: SnapshotSource['endpointType'][]): string[] {
  return s.sources.filter((x) => x.usable && types.includes(x.endpointType)).map((x) => x.id);
}

function bars(s: AnalysisSnapshot, n: number): RoleInput['recentBars'] {
  const src = usable(s, s.derived.candleSource);
  if (!src) return undefined;
  const p = src.payload as CandlePayload;
  const row = (c: Candle) => [new Date(c.openTime).toISOString(), c.open, c.high, c.low, c.close, c.volume];
  return { interval: p.interval, rows: p.candles.slice(-n).map(row), current: p.current ? [...row(p.current), 'incomplete'] : null };
}

/** derived:<이름> 참조가 가리키는 값 전체 (역할 입력의 derived와 같은 모양) */
export function derivedValues(s: AnalysisSnapshot): Record<string, unknown> {
  return indicators(s);
}

function indicators(s: AnalysisSnapshot, keys?: string[]): Record<string, unknown> {
  const ind = s.derived.indicators;
  if (!ind) return {};
  const all: Record<string, unknown> = { ...ind };
  delete all.indicatorsVersion;
  const out = keys ? Object.fromEntries(keys.filter((k) => k in all).map((k) => [k, all[k]])) : all;
  for (const sp of s.derived.spreads) out[sp.name] = sp.value;
  return out;
}

function priceBasis(s: AnalysisSnapshot): RoleInput['priceBasis'] {
  const id = judgmentPriceSourceOf(s);
  const src = usable(s, id);
  if (!src) return undefined;
  const p = src.payload as PricePayload;
  return { sourceRef: id, currency: p.currency, last: p.last, mark: p.mark };
}

/** 판정 기준 가격 한 개 (mark 우선, 없으면 last). 포지션 파생 값의 현재가 (P2 포지션 명세 3.2절). 추정 시세는 쓰지 않는다 */
export function referencePrice(s: AnalysisSnapshot): { value: number; kind: 'mark' | 'last'; sourceRef: string; currency: Currency } | null {
  const id = judgmentPriceSourceOf(s);
  const src = usable(s, id);
  if (!src || src.estimated) return null;
  const p = src.payload as PricePayload;
  if (p.mark !== null && p.mark > 0) return { value: p.mark, kind: 'mark', sourceRef: id, currency: p.currency };
  if (p.last !== null && p.last > 0) return { value: p.last, kind: 'last', sourceRef: id, currency: p.currency };
  return null;
}

function judgmentPriceSourceOf(s: AnalysisSnapshot): string {
  // 스냅샷에는 Instrument가 없으므로 소스 목록에서 판정 기준 가격을 고른다
  const ids = s.sources.map((x) => x.id);
  if (s.mode !== 'algorithm') return 'binance.perp.price';
  return ids.includes('binance.spot.price') ? 'binance.spot.price' : 'yahoo.spot.price';
}

/** 브리핑에서 말풍선·전문을 뺀 정형 부분 (토큰 절약) */
function structured(b: Briefing | undefined) {
  if (!b) return undefined;
  const { narrative: _n, summary: _s, ...rest } = b;
  return rest;
}

const VOL_KEYS = ['atr14', 'realizedVol', 'realizedVolPeriod', 'recentHigh20', 'recentLow20', 'lastClose'];

export function buildRoleInput(s: AnalysisSnapshot, role: Role, prior: PriorOutputs = {}): RoleInput {
  const base: RoleInput = {
    role, jobId: s.jobId, snapshotId: s.snapshotId, instrumentId: s.instrumentId, displayName: s.displayName,
    mode: s.mode, marketType: s.marketType, collectedAt: s.collectedAt, market: s.market,
    sources: {}, derived: {}, dataWarnings: [],
  };
  const priceIds = sourceIds(s, ['price']).filter((id) => id === judgmentPriceSourceOf(s) || id === 'binance.perp.price');
  const news = usable(s, 'news.google')?.payload as NewsPayload | undefined;
  const b = prior.briefings ?? {};

  switch (role) {
    case 'TARO':
      Object.assign(base, { sources: pick(s, priceIds), derived: indicators(s), recentBars: bars(s, BARS[s.mode]) });
      break;
    case 'DIANA':
      Object.assign(base, { sources: pick(s, [...priceIds, ...sourceIds(s, ['fundamentals'])]) });
      break;
    case 'NOVA':
      base.untrusted = { news: news?.items.map((n) => ({ title: n.title, source: n.source, publishedAt: n.publishedAt, summary: n.summary })) ?? [] };
      break;
    case 'VIBE':
      base.sources = pick(s, sourceIds(s, ['sentiment']));
      base.untrusted = { news: news?.items.map((n) => ({ title: n.title, source: n.source, publishedAt: n.publishedAt })) ?? [] };
      break;
    case 'BULL':
    case 'BEAR':
      base.prior = {
        round: prior.debateRound ?? 1,
        briefings: (['TARO', 'DIANA', 'NOVA', 'VIBE'] as const).map((r) => structured(b[r])).filter(Boolean),
        debate: prior.debate ?? [],
      };
      break;
    case 'BLITZ':
      Object.assign(base, {
        sources: pick(s, [...priceIds, ...sourceIds(s, ['funding'])]), derived: indicators(s), recentBars: bars(s, BARS[s.mode]),
        priceBasis: priceBasis(s), prior: { briefings: [structured(b.TARO), structured(b.VIBE)].filter(Boolean) },
      });
      break;
    case 'GUARD':
      Object.assign(base, { sources: pick(s, sourceIds(s, ['funding'])), derived: indicators(s, VOL_KEYS), prior: { blitzPlan: prior.blitzPlan } });
      break;
    case 'ACE':
      Object.assign(base, {
        sources: pick(s, priceIds), derived: indicators(s), priceBasis: priceBasis(s),
        prior: s.mode === 'algorithm'
          ? { briefings: (['TARO', 'DIANA', 'NOVA', 'VIBE'] as const).map((r) => structured(b[r])).filter(Boolean), debate: prior.debate ?? [] }
          : { briefings: [structured(b.TARO), structured(b.VIBE)].filter(Boolean), blitzPlan: prior.blitzPlan, guardReview: structured(b.GUARD) },
      });
      break;
    case 'RISKY':
    case 'SAFE':
    case 'NEUTRAL':
      Object.assign(base, { derived: indicators(s, VOL_KEYS), prior: { proposal: prior.proposal, reviews: (prior.reviews ?? []).map(structured) } });
      break;
    case 'PM':
      Object.assign(base, {
        priceBasis: priceBasis(s), dataWarnings: s.dataQuality.warnings,
        prior: { proposal: prior.proposal, reviews: (prior.reviews ?? []).map(structured) },
      });
      break;
  }
  if (role !== 'PM') base.dataWarnings = s.dataQuality.warnings.filter((w) => !w.startsWith('선택 소스')).slice(0, 5);
  // 앞선 역할 출력(prior)은 압축하지 않는다: 제안서 가격이 바뀌면 PM 수정 필드 계산이 틀어진다
  const { prior: priorOut, ...rest } = base;
  return { ...compact(rest), ...(priorOut ? { prior: priorOut } : {}) };
}

export class InputBudgetError extends Error {}

/**
 * 입력이 상한을 넘으면 뉴스 요약 → 뉴스 건수 → (회고: 비활성) → 최근 봉 개수 순으로 줄인다 (P0-8-R3).
 * 필수 데이터까지 줄여야 하면 InputBudgetError.
 */
export function fitInput(input: RoleInput, maxChars: number, systemChars: number): { input: RoleInput; text: string; reductions: string[] } {
  const reductions: string[] = [];
  let cur = structuredClone(input);
  const size = () => JSON.stringify(cur).length + systemChars;
  if (size() <= maxChars) return { input: cur, text: JSON.stringify(cur), reductions };

  const news = cur.untrusted?.news;
  if (news?.some((n) => n.summary)) {
    for (const n of news) n.summary = null;
    reductions.push('뉴스 요약 제거');
  }
  while (size() > maxChars && cur.untrusted?.news && cur.untrusted.news.length > 3) {
    cur.untrusted.news = cur.untrusted.news.slice(0, Math.ceil(cur.untrusted.news.length / 2));
    reductions.push(`뉴스 ${cur.untrusted.news.length}건으로 축소`);
  }
  while (size() > maxChars && cur.recentBars && cur.recentBars.rows.length > 8) {
    cur = { ...cur, recentBars: { ...cur.recentBars, rows: cur.recentBars.rows.slice(-Math.ceil(cur.recentBars.rows.length / 2)) } };
    reductions.push(`최근 봉 ${cur.recentBars!.rows.length}개로 축소`);
  }
  if (size() > maxChars) throw new InputBudgetError(`${input.role} 입력 ${size()}자가 상한 ${maxChars}자를 넘음`);
  cur.dataWarnings = [...cur.dataWarnings, ...reductions.map((r) => `입력 축소: ${r}`)];
  return { input: cur, text: JSON.stringify(cur), reductions };
}

