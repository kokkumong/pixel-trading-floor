// 기술 지표 (P1 명세 3.1). 정의와 파라미터를 고정하고 INDICATORS_VERSION으로 묶는다 (P1-3-R1).
// 최소 봉 수보다 데이터가 적으면 null (P1-3-R2). 입력은 완성 봉만 (candles.ts가 미완성 봉을 뺀다).
import type { Candle } from './candles.ts';

export const INDICATORS_VERSION = 'ind/1';

/** SMA(n): 마지막 n개 종가 단순 평균 */
export function sma(values: readonly number[], n: number): number | null {
  if (values.length < n) return null;
  let s = 0;
  for (let i = values.length - n; i < values.length; i++) s += values[i]!;
  return s / n;
}

/** EMA 시계열: α = 2/(n+1), 첫 값은 처음 n개의 SMA. 결과[i]는 values[i]까지의 EMA (i < n-1은 null) */
export function emaSeries(values: readonly number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < n) return out;
  const a = 2 / (n + 1);
  let e = 0;
  for (let i = 0; i < n; i++) e += values[i]!;
  e /= n;
  out[n - 1] = e;
  for (let i = n; i < values.length; i++) {
    e = a * values[i]! + (1 - a) * e;
    out[i] = e;
  }
  return out;
}

export function ema(values: readonly number[], n: number): number | null {
  return emaSeries(values, n).at(-1) ?? null;
}

/** Wilder 평활: 첫 값은 처음 n개 평균, 이후 prev + (x − prev)/n */
function wilder(xs: readonly number[], n: number): number | null {
  if (xs.length < n) return null;
  let v = 0;
  for (let i = 0; i < n; i++) v += xs[i]!;
  v /= n;
  for (let i = n; i < xs.length; i++) v = v + (xs[i]! - v) / n;
  return v;
}

/** RSI(14), Wilder. 하락이 없으면 100, 상승·하락 모두 없으면 50 (P1-3-R3). 최소 15봉 */
export function rsi(closes: readonly number[], n = 14): number | null {
  if (closes.length < n + 1) return null;
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    gains.push(d > 0 ? d : 0);
    losses.push(d < 0 ? -d : 0);
  }
  const g = wilder(gains, n)!;
  const l = wilder(losses, n)!;
  if (l === 0 && g === 0) return 50;
  if (l === 0) return 100;
  return 100 - 100 / (1 + g / l);
}

/** MACD(12,26,9). 최소 34봉 */
export function macd(closes: readonly number[]): { macd: number; signal: number; hist: number } | null {
  if (closes.length < 34) return null;
  const e12 = emaSeries(closes, 12);
  const e26 = emaSeries(closes, 26);
  const line: number[] = [];
  for (let i = 25; i < closes.length; i++) line.push(e12[i]! - e26[i]!);
  const sig = emaSeries(line, 9);
  const m = line.at(-1)!;
  const s = sig.at(-1)!;
  return { macd: m, signal: s, hist: m - s };
}

/** ATR(14): True Range의 Wilder 평활. TR은 두 번째 봉부터 (이전 종가 필요). 최소 15봉 */
export function atr(candles: readonly Candle[], n = 14): number | null {
  if (candles.length < n + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const pc = candles[i - 1]!.close;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc)));
  }
  return wilder(trs, n);
}

/** 실현 변동성: 마지막 period개 로그 수익률의 표본 표준편차(n−1). 연율화하지 않음. 최소 period+1봉 */
export function realizedVol(closes: readonly number[], period: number): number | null {
  if (closes.length < period + 1) return null;
  const r: number[] = [];
  for (let i = closes.length - period; i < closes.length; i++) r.push(Math.log(closes[i]! / closes[i - 1]!));
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1);
  return Math.sqrt(v);
}

/** 최근 20봉 최고가·최저가 */
export function recentHighLow(candles: readonly Candle[], n = 20): { high: number; low: number } | null {
  if (candles.length < n) return null;
  const s = candles.slice(-n);
  return { high: Math.max(...s.map((c) => c.high)), low: Math.min(...s.map((c) => c.low)) };
}

export interface Indicators {
  indicatorsVersion: string;
  basis: 'close' | 'adjClose';
  bars: number;
  lastClose: number | null;
  sma20: number | null;
  sma50: number | null;
  ema20: number | null;
  rsi14: number | null;
  macd: { macd: number; signal: number; hist: number } | null;
  atr14: number | null;
  realizedVol: number | null;
  realizedVolPeriod: number;
  recentHigh20: number | null;
  recentLow20: number | null;
}

/**
 * 완성 봉으로 지표 묶음을 계산한다. 주식 일봉은 수정주가(adjClose)로 가격 지표를 계산한다 (P1-3-R9).
 * ATR·고저는 OHLC가 필요하므로 원시 가격을 쓴다 (수정 계수를 모르므로 섞지 않음).
 */
export function computeIndicators(candles: readonly Candle[], volPeriod: number, useAdjusted: boolean): Indicators {
  const adjusted = useAdjusted && candles.length > 0 && candles.every((c) => typeof c.adjClose === 'number');
  const closes = candles.map((c) => (adjusted ? c.adjClose! : c.close));
  const hl = recentHighLow(candles);
  return {
    indicatorsVersion: INDICATORS_VERSION,
    basis: adjusted ? 'adjClose' : 'close',
    bars: candles.length,
    lastClose: closes.at(-1) ?? null,
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    ema20: ema(closes, 20),
    rsi14: rsi(closes),
    macd: macd(closes),
    atr14: atr(candles),
    realizedVol: realizedVol(closes, volPeriod),
    realizedVolPeriod: volPeriod,
    recentHigh20: hl?.high ?? null,
    recentLow20: hl?.low ?? null,
  };
}
