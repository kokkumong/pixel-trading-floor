// 개발용 확인 도구: 지금까지 만든 코어(종목 해석 → 데이터 수집 → 스냅샷 → 역할별 입력 → 규칙 엔진)를 실제 데이터로 보여준다.
// 모델(claude)은 호출하지 않는다. 규칙 엔진에는 예시 제안서 두 개(정상, 손절 역전)를 넣어 본다.
//   node scripts/inspect.ts <종목> [algorithm|scalp|forced_direction]
import { yahooUsLookup } from '../src/core/data/adapters.ts';
import { createRealNet } from '../src/core/data/net.ts';
import { buildRoleInput } from '../src/core/data/project.ts';
import { InstrumentRegistry } from '../src/core/data/registry.ts';
import { collectSnapshot, type AnalysisSnapshot } from '../src/core/data/snapshot.ts';
import type { PricePayload } from '../src/core/data/sources.ts';
import { actionBiasLabel } from '../src/core/rules/display.ts';
import { applyRules } from '../src/core/rules/engine.ts';
import { createEvidenceIndex } from '../src/core/rules/evidence.ts';
import type { TradeProposal } from '../src/core/schema/proposal.ts';
import { MODES, ROLES, type Mode } from '../src/core/schema/types.ts';

const [symbol = 'BTC', modeArg = 'scalp'] = process.argv.slice(2);
const mode = (MODES as readonly string[]).includes(modeArg) ? (modeArg as Mode) : 'scalp';
const line = (s = '') => console.log(s);
const h = (s: string) => line(`\n━━ ${s} ${'━'.repeat(Math.max(0, 60 - s.length))}`);

const net = createRealNet();
const registry = new InstrumentRegistry();

h('1. 종목 해석');
const res = await registry.resolveWithLookup(symbol, mode, yahooUsLookup(net));
if (!res.ok) {
  line(`✗ ${res.code} (${res.reason}): ${res.message}`);
  if (res.candidates.length) line(`  후보: ${res.candidates.map((c) => c.displayName).join(', ')}`);
  process.exit(0);
}
line(`입력 "${symbol}" → ${res.instrument.instrumentId}`);
line(`분석 대상: ${res.description}`);

h('2. 데이터 수집과 스냅샷');
const t0 = Date.now();
const snap = await collectSnapshot(net, {
  jobId: 'inspect', mode, symbolInput: symbol, instrument: res.instrument, marketType: res.marketType,
  registryVersion: registry.version, requestedAt: new Date(),
});
line(`수집 ${Date.now() - t0}ms · 장 상태: ${snap.market.label} · 해시 ${snap.snapshotHash.slice(0, 19)}…`);
line(`데이터 품질: ${snap.dataQuality.status} (필수 ${snap.dataQuality.requiredOk}, 선택 완전성 ${(snap.dataQuality.optionalCompleteness * 100).toFixed(0)}%)`);
line();
for (const s of snap.sources) {
  const mark = s.usable ? '✓' : '✗';
  const age = s.ageSeconds === null ? '시각 미확인' : fmtAge(s.ageSeconds);
  line(`  ${mark} ${s.required ? '[필수]' : '[선택]'} ${s.id.padEnd(26)} ${s.freshness.padEnd(13)} ${age.padEnd(10)} ${s.error ?? summary(s)}`);
}
if (snap.dataQuality.warnings.length) {
  line();
  for (const w of snap.dataQuality.warnings) line(`  ⚠ ${w}`);
}

h('3. 코드가 계산한 지표');
const ind = snap.derived.indicators;
if (ind) {
  line(`기준: ${snap.derived.candleSource} 완성 봉 ${ind.bars}개 (${ind.basis})`);
  line(`  종가 ${f(ind.lastClose)} · SMA20 ${f(ind.sma20)} · SMA50 ${f(ind.sma50)} · EMA20 ${f(ind.ema20)}`);
  line(`  RSI14 ${f(ind.rsi14, 2)} · MACD ${f(ind.macd?.macd)} / 시그널 ${f(ind.macd?.signal)} / 히스토그램 ${f(ind.macd?.hist)}`);
  line(`  ATR14 ${f(ind.atr14)} · 실현 변동성(${ind.realizedVolPeriod}봉) ${f(ind.realizedVol, 5)} · 최근 20봉 고/저 ${f(ind.recentHigh20)} / ${f(ind.recentLow20)}`);
  if (snap.derived.currentBar) line(`  진행 중인 봉(계산 제외): ${snap.derived.currentBar.openTime} 종가 ${f(snap.derived.currentBar.close)}`);
}
for (const sp of snap.derived.spreads) line(`  괴리 ${sp.name}: ${(sp.value * 100).toFixed(2)}% (환율 ${sp.fxSourceRef}, 가정: ${sp.assumptions.join(', ')})`);

h('4. 역할별 모델 입력 (모델에 실제로 넘길 크기)');
const roles = mode === 'algorithm'
  ? ROLES.filter((r) => !['BLITZ', 'GUARD'].includes(r))
  : (['TARO', 'VIBE', 'BLITZ', 'GUARD', 'ACE'] as const);
for (const role of roles) {
  const input = buildRoleInput(snap, role);
  const keys = [
    Object.keys(input.sources).length && `원자료 ${Object.keys(input.sources).length}`,
    Object.keys(input.derived).length && `지표 ${Object.keys(input.derived).length}`,
    input.recentBars && `봉 ${input.recentBars.rows.length}개`,
    input.untrusted?.news && `뉴스(불신 블록) ${input.untrusted.news.length}건`,
  ].filter(Boolean).join(', ');
  line(`  ${role.padEnd(8)} ${String(JSON.stringify(input).length).padStart(6)}자  ${keys || '(앞 단계 출력만 받음)'}`);
}
const news = buildRoleInput(snap, 'NOVA').untrusted?.news ?? [];
if (news.length) {
  line('\n  NOVA가 받을 뉴스 제목 (최대 3건):');
  for (const n of news.slice(0, 3)) line(`    · ${n.title} — ${n.source ?? '?'} (${n.publishedAt.slice(0, 16)}Z)`);
}

h('5. 규칙 엔진 시험 (예시 제안서, 모델 호출 없음)');
const basisId = mode === 'algorithm' ? (res.instrument.assetClass === 'crypto' ? 'binance.spot.price' : 'yahoo.spot.price') : 'binance.perp.price';
const basis = snap.sources.find((s) => s.id === basisId);
const px = (basis?.payload as PricePayload | null)?.last ?? null;
if (!px || !ind?.atr14) {
  line('기준 가격이나 ATR이 없어 건너뜀');
} else {
  const atrv = ind.atr14;
  const good = sample(snap, px, px - 1.5 * atrv, [px + 2 * atrv, px + 3 * atrv]);
  const bad = sample(snap, px, px + 1.5 * atrv, [px + 2 * atrv]);
  for (const [label, p] of [['정상 롱 제안', good], ['손절이 진입가 위인 롱 제안', bad]] as const) {
    const o = applyRules(p, ruleCtx(snap));
    line(`  ${label}: 진입 ${f(px)} 손절 ${f(p.stopLoss)} 목표 ${p.targets.map((x) => f(x)).join('/')}`);
    line(`    → ${o.verdict} · ${actionBiasLabel(o.action, o.bias)} · 위반 [${o.violations.map((v) => v.code).join(', ') || '없음'}]`
      + (o.risk ? ` · 손절 거리 ${o.risk.stopDistancePercent.toFixed(2)}% (증거금 소진 거리 ${o.risk.roughMarginLimitPercent}% 가정)` : ''));
    for (const w of o.warnings) line(`    ⚠ ${w}`);
  }
}
line();

function sample(s: AnalysisSnapshot, entry: number, stop: number, targets: number[]): TradeProposal {
  return {
    schemaVersion: 'proposal/2', jobId: 'inspect', author: 'ACE', instrumentId: s.instrumentId, snapshotId: s.snapshotId,
    action: 'ENTER_LONG', bias: 'BULLISH', unforcedAction: mode === 'forced_direction' ? 'NO_TRADE' : null, marketType: s.marketType,
    priceBasis: { sourceRef: basisId, currency: s.quoteCurrency }, timeframe: mode === 'algorithm' ? '1d' : '15m',
    expectedHoldingPeriod: '예시', validForMinutes: 120, entry: { type: 'limit', min: entry, max: entry },
    stopLoss: stop, targets, leverage: s.marketType === 'perpetual' ? 20 : null, confidence: 55,
    rationale: '확인용 예시', evidenceRefs: ['derived:rsi14', `snap:${basisId}#/last`], invalidationConditions: [], warnings: [],
  };
}

function ruleCtx(s: AnalysisSnapshot) {
  const sources: Record<string, { estimated: boolean; price: number | null }> = {};
  const payloads: Record<string, unknown> = {};
  for (const x of s.sources) {
    if (x.endpointType === 'price') sources[x.id] = { estimated: x.estimated, price: (x.payload as PricePayload | null)?.last ?? null };
    if (x.usable) payloads[x.id] = x.payload;
  }
  const perp = s.sources.find((x) => x.id === 'binance.perp.price')?.payload as PricePayload | undefined;
  return {
    mode, dataQuality: s.dataQuality.status, sources, atr14: s.derived.indicators?.atr14 ?? null,
    riskPrice: s.marketType === 'perpetual' && perp?.mark ? { value: perp.mark, kind: 'mark' as const } : null,
    evidence: createEvidenceIndex({ snapshot: payloads, derived: { ...s.derived.indicators }, briefs: {} }),
  };
}

function summary(s: AnalysisSnapshot['sources'][number]): string {
  const p = s.payload as Record<string, any> | null;
  if (!p) return '';
  switch (s.endpointType) {
    case 'price': return 'value' in p ? `추정 ${f(p.value)} (${p.used?.length ?? 0}개 거래소)` : `${f(p.last)} ${p.currency}${p.mark ? ` · 마크 ${f(p.mark)}` : ''}`;
    case 'candle': return `완성 봉 ${p.candles.length}개 (${p.interval})`;
    case 'funding': return `${(p.rate * 100).toFixed(4)}% / ${p.intervalHours}시간 (8시간 환산 ${(p.rate8h * 100).toFixed(4)}%)`;
    case 'fx': return `USDKRW ${f(p.rate)}`;
    case 'sentiment': return `${p.value} (${p.classification})`;
    case 'news': return `헤드라인 ${p.items.length}건`;
    case 'fundamentals': return [p.marketCap && `시총 ${f(p.marketCap / 1e9)}B`, p.fiftyTwoWeekHigh && `52주 ${f(p.fiftyTwoWeekLow)}~${f(p.fiftyTwoWeekHigh)}`].filter(Boolean).join(' · ');
    default: return '';
  }
}

function f(x: number | null | undefined, d?: number): string {
  if (x === null || x === undefined) return '—';
  if (d !== undefined) return x.toFixed(d);
  const abs = Math.abs(x);
  return x.toLocaleString('en-US', { maximumFractionDigits: abs >= 1000 ? 0 : abs >= 1 ? 2 : 6 });
}

function fmtAge(sec: number): string {
  if (sec < 120) return `${sec}초 전`;
  if (sec < 7200) return `${Math.round(sec / 60)}분 전`;
  return `${Math.round(sec / 3600)}시간 전`;
}
