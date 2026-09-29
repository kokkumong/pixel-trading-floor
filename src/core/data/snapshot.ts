// AnalysisSnapshot (P0 명세 4.2, 4.5). 작업당 한 번 수집해 불변 객체로 고정하고 해시를 남긴다.
// collectSnapshot은 네트워크를 쓰고, assembleSnapshot은 순수 함수라 fixture로 테스트한다.
import { createHash, randomUUID } from 'node:crypto';
import type { Currency, DataQualityStatus, MarketType, Mode } from '../schema/types.ts';
import {
  binancePerp, binanceSpot, coingecko, failed, fearGreed, googleNews, otherPerp, yahooFx, yahooStock,
} from './adapters.ts';
import { CALENDAR_VERSION, marketStatus, type MarketStatus } from './calendar.ts';
import { checkCandles } from './candles.ts';
import { estimatePrice } from './estimate.ts';
import { evaluateFreshness, type Freshness } from './freshness.ts';
import { computeIndicators, type Indicators } from './indicators.ts';
import type { NetClient } from './net.ts';
import { convert, spreadRatio, type PriceTag } from './price.ts';
import type { Instrument } from './registry.ts';
import {
  judgmentCandleSource, judgmentPriceSource, MIN_BARS, planSources,
  type CandlePayload, type FxPayload, type PricePayload, type SourceRecord, type SourceSpec,
} from './sources.ts';

export interface SnapshotSource extends SourceRecord {
  required: boolean;
  ageSeconds: number | null;
  ttlSeconds: number;
  freshness: Freshness;
  stale: boolean;
  /** 에이전트 입력에 넣을 수 있는지 (실패·만료·시각 미확인·추정은 false) */
  usable: boolean;
}

export interface Spread {
  name: string;
  value: number;
  a: string;
  b: string;
  fxSourceRef: string;
  assumptions: string[];
}

export interface AnalysisSnapshot {
  schemaVersion: 'snapshot/2';
  snapshotId: string;
  snapshotHash: string;
  jobId: string;
  mode: Mode;
  symbolInput: string;
  instrumentId: string;
  displayName: string;
  marketType: MarketType;
  quoteCurrency: Currency;
  requestedAt: string;
  collectedAt: string;
  market: Pick<MarketStatus, 'state' | 'label' | 'timezone'>;
  sources: SnapshotSource[];
  derived: {
    indicatorsVersion: string;
    candleSource: string;
    indicators: Indicators | null;
    currentBar: { openTime: string; close: number; incomplete: true } | null;
    spreads: Spread[];
  };
  dataQuality: {
    status: DataQualityStatus;
    requiredOk: string; // "3/3"
    optionalCompleteness: number;
    warnings: string[];
  };
  versions: { registry: string; calendar: string; indicators: string };
}

export interface SnapshotInput {
  jobId: string;
  mode: Mode;
  symbolInput: string;
  instrument: Instrument;
  marketType: MarketType;
  registryVersion: string;
  requestedAt: Date;
  collectedAt: Date;
  records: SourceRecord[];
  snapshotId?: string;
}

/** 필요한 소스만 공급자별로 묶어 병렬 수집한다. */
export async function collectSources(net: NetClient, inst: Instrument, mode: Mode, now: () => Date = () => new Date()): Promise<SourceRecord[]> {
  const plan = planSources(inst, mode);
  const want = new Set(plan.map((s) => s.id));
  const has = (id: string) => want.has(id);
  const tasks: Promise<SourceRecord | SourceRecord[]>[] = [];
  const primaryPerp = inst.perpetuals.find((p) => p.primary);

  if (has('binance.spot.price') || has('binance.spot.candles.1d')) tasks.push(binanceSpot(net, inst, has('binance.spot.candles.1d')));
  if (primaryPerp && (has('binance.perp.price') || has('binance.perp.funding'))) {
    tasks.push(binancePerp(net, primaryPerp.symbol, has('binance.perp.candles.15m')));
  }
  if (has('yahoo.spot.price') || has('yahoo.spot.candles.1d')) tasks.push(yahooStock(net, inst));
  if (has('yahoo.fx.usdkrw')) tasks.push(yahooFx(net));
  if (has('coingecko.fundamentals')) tasks.push(coingecko(net, inst));
  if (has('feargreed.alternative')) tasks.push(fearGreed(net));
  if (has('news.google')) tasks.push(googleNews(net, inst, now()));
  for (const p of inst.perpetuals.filter((x) => !x.primary)) {
    if (has(`${p.exchange}.perp.price`)) tasks.push(otherPerp(net, p.exchange, p.symbol));
  }
  const flat = (await Promise.all(tasks)).flat();
  return flat.filter((r) => want.has(r.id));
}

export async function collectSnapshot(
  net: NetClient,
  args: Omit<SnapshotInput, 'records' | 'collectedAt'>,
  now: () => Date = () => new Date(),
): Promise<AnalysisSnapshot> {
  const records = await collectSources(net, args.instrument, args.mode, now);
  return assembleSnapshot({ ...args, records, collectedAt: now() });
}

/** 순수 함수: 수집 기록 → 품질 판정, 파생 지표, 해시가 붙은 스냅샷 */
export function assembleSnapshot(input: SnapshotInput): AnalysisSnapshot {
  const { instrument: inst, mode, collectedAt: now } = input;
  const plan = planSources(inst, mode);
  const warnings: string[] = [];
  const byId = new Map(input.records.map((r) => [r.id, r]));

  // 1. 캔들 무결성 (P1-3-R4, R5)
  const cleaned = new Map<string, SourceRecord>();
  let currentBar: AnalysisSnapshot['derived']['currentBar'] = null;
  const candleId = judgmentCandleSource(inst, mode);
  for (const spec of plan) {
    const rec = byId.get(spec.id) ?? failed(spec.id, '?', 'price', '수집되지 않음');
    if (rec.endpointType !== 'candle' || rec.status === 'failed') {
      cleaned.set(spec.id, rec);
      continue;
    }
    const p = rec.payload as CandlePayload;
    const chk = checkCandles(p.candles, { intervalMs: (rec.intervalSeconds ?? 86_400) * 1000, now, calendar: inst.calendarId, label: spec.id });
    warnings.push(...chk.warnings);
    let status = rec.status;
    const min = MIN_BARS[spec.id] ?? 0;
    if (chk.candles.length < min) {
      status = 'partial';
      warnings.push(`${spec.id}: 완성 봉 ${chk.candles.length}개 (지표 계산 최소 ${min}개)`);
    }
    if (chk.partial) status = 'partial';
    if (spec.id === candleId && chk.current) {
      currentBar = { openTime: new Date(chk.current.openTime).toISOString(), close: chk.current.close, incomplete: true };
    }
    cleaned.set(spec.id, { ...rec, status, payload: { ...p, candles: chk.candles, current: chk.current } satisfies CandlePayload });
  }

  // 2. 추정 시세 (한국 종목: 여러 거래소 무기한 가격의 중앙값, 표시 전용)
  const perpPrices = inst.perpetuals
    .map((p) => ({ exchange: p.exchange, rec: cleaned.get(`${p.exchange}.perp.price`) }))
    .filter((x) => x.rec && x.rec.status === 'ok' && x.rec.observedAt !== null) // 시각 미확인 가격은 추정에 쓰지 않음
    .map((x) => ({ exchange: x.exchange, price: (x.rec!.payload as PricePayload).last ?? NaN }));
  const extra: SourceSpec[] = [];
  if (inst.primaryMarket === 'KRX' && inst.perpetuals.length >= 3 && perpPrices.length > 0) {
    const est = estimatePrice(perpPrices);
    const obs = [...cleaned.values()].filter((r) => r.id.endsWith('.perp.price') && r.observedAt).map((r) => r.observedAt!).sort()[0] ?? null;
    cleaned.set('tapbit.perp.estimate', {
      id: 'tapbit.perp.estimate', provider: 'estimate', endpointType: 'price', observedAt: obs, fetchedAt: now.toISOString(),
      status: est.value === null ? 'failed' : 'ok', estimated: true, untrustedText: false, payload: est,
      ...(est.reason ? { error: `산출 불가: ${est.reason}` } : {}),
    });
    extra.push({ id: 'tapbit.perp.estimate', required: false });
  }

  // 3. 신선도와 사용 가능 여부
  const sources: SnapshotSource[] = [...plan, ...extra].map((spec) => {
    const rec = cleaned.get(spec.id)!;
    const f = evaluateFreshness(rec, inst, mode, now);
    const usable = rec.status !== 'failed' && !f.stale && f.freshness !== 'UNKNOWN_TIME' && !rec.estimated;
    if (f.note) warnings.push(`${spec.id}: ${f.note}`);
    return { ...rec, required: spec.required, ...f, usable };
  });

  // 4. 품질 판정 (P0 명세 4.5)
  const required = sources.filter((s) => s.required);
  const requiredOk = required.filter((s) => s.usable && s.status === 'ok');
  for (const s of required) {
    if (s.usable && s.status === 'ok') continue;
    const why = s.status === 'failed' ? `실패 (${s.error ?? '원인 불명'})` : s.status === 'partial' ? '부분 데이터' : s.stale ? `만료 (${s.ageSeconds}초 경과, TTL ${s.ttlSeconds}초)` : s.freshness === 'UNKNOWN_TIME' ? '시각 미확인' : '추정값만 있음';
    warnings.push(`필수 소스 ${s.id}: ${why}`);
  }
  const optional = sources.filter((s) => !s.required);
  const optionalOk = optional.filter((s) => s.usable && s.status === 'ok');
  for (const s of optional) {
    if (s.estimated || (s.usable && s.status === 'ok')) continue;
    warnings.push(`선택 소스 ${s.id} 제외: ${s.status === 'failed' ? s.error ?? '실패' : s.stale ? '만료' : s.freshness === 'UNKNOWN_TIME' ? '시각 미확인' : '부분 데이터'}`);
  }
  const optionalPlanned = optional.filter((s) => !s.estimated);
  const status: DataQualityStatus = requiredOk.length < required.length ? 'INSUFFICIENT_DATA'
    : optionalOk.length < optionalPlanned.length ? 'PARTIAL_DATA' : 'OK';

  // 5. 파생 값: 지표, 괴리
  const candleSrc = sources.find((s) => s.id === candleId);
  const indicators = candleSrc && candleSrc.status !== 'failed'
    ? computeIndicators((candleSrc.payload as CandlePayload).candles, mode === 'algorithm' ? 20 : 32, candleId.startsWith('yahoo.'))
    : null;
  const spreads = computeSpreads(inst, sources, warnings);

  const priceSrc = judgmentPriceSource(inst, mode);
  const quoteCurrency = ((sources.find((s) => s.id === priceSrc)?.payload as PricePayload | null)?.currency) ?? inst.primaryCurrency;
  const st = marketStatus(inst.calendarId, now);

  const body: Omit<AnalysisSnapshot, 'snapshotHash'> = {
    schemaVersion: 'snapshot/2',
    snapshotId: input.snapshotId ?? randomUUID(),
    jobId: input.jobId,
    mode,
    symbolInput: input.symbolInput,
    instrumentId: inst.instrumentId,
    displayName: inst.displayName,
    marketType: input.marketType,
    quoteCurrency,
    requestedAt: input.requestedAt.toISOString(),
    collectedAt: now.toISOString(),
    market: { state: st.state, label: st.label, timezone: st.timezone },
    sources,
    derived: { indicatorsVersion: indicators?.indicatorsVersion ?? 'ind/1', candleSource: candleId, indicators, currentBar, spreads },
    dataQuality: {
      status,
      requiredOk: `${requiredOk.length}/${required.length}`,
      optionalCompleteness: optionalPlanned.length ? round(optionalOk.filter((s) => !s.estimated).length / optionalPlanned.length, 4) : 1,
      warnings,
    },
    versions: { registry: input.registryVersion, calendar: CALENDAR_VERSION, indicators: indicators?.indicatorsVersion ?? 'ind/1' },
  };
  return { ...body, snapshotHash: hashSnapshot(body) } as AnalysisSnapshot;
}

/** 한국 종목: 무기한(USDT) ↔ KRX 현물(KRW) 괴리. 환율 소스가 있을 때만 (P0-4-R6, P1-2-R7) */
function computeSpreads(inst: Instrument, sources: SnapshotSource[], warnings: string[]): Spread[] {
  if (inst.primaryMarket !== 'KRX') return [];
  const get = (id: string) => sources.find((s) => s.id === id && s.usable && s.status === 'ok');
  const fx = get('yahoo.fx.usdkrw');
  const perp = get('binance.perp.price');
  const spot = get('yahoo.spot.price');
  if (!fx || !perp || !spot) return [];
  const perpP = perp.payload as PricePayload;
  const spotP = spot.payload as PricePayload;
  if (perpP.last === null || spotP.last === null) return [];
  const fxInfo = { rate: (fx.payload as FxPayload).rate, pair: 'USDKRW', sourceRef: fx.id, observedAt: fx.observedAt };
  const a: PriceTag = { value: perpP.last, currency: 'USDT', marketType: 'perpetual', priceKind: 'last', sourceRef: perp.id, estimated: false };
  const b: PriceTag = { value: spotP.last, currency: 'KRW', marketType: 'spot', priceKind: 'last', sourceRef: spot.id, estimated: false };
  try {
    return [{
      name: 'perpVsKrx', value: round(spreadRatio(convert(a, 'KRW', fxInfo), b), 6), a: perp.id, b: spot.id, fxSourceRef: fx.id,
      assumptions: ['USDT = USD로 환산', 'KRX 현물은 장 마감 뒤 종가일 수 있음'],
    }];
  } catch (e) {
    warnings.push(`괴리 계산 실패: ${(e as Error).message}`);
    return [];
  }
}

/** 키를 정렬한 정규화 JSON의 sha256 (P0-4-R1) */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonicalJson(x)}`).join(',')}}`;
}

export function hashSnapshot(s: Omit<AnalysisSnapshot, 'snapshotHash'> | AnalysisSnapshot): string {
  const { snapshotHash: _ignored, ...body } = s as AnalysisSnapshot;
  return 'sha256:' + createHash('sha256').update(canonicalJson(body)).digest('hex');
}

function round(x: number, d: number): number {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
