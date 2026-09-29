import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Candle } from '../../../src/core/data/candles.ts';
import { atr, computeIndicators, ema, macd, realizedVol, recentHighLow, rsi, sma } from '../../../src/core/data/indicators.ts';

const fx = JSON.parse(readFileSync(new URL('../../../fixtures/indicators/btc-perp-15m.json', import.meta.url), 'utf8'));
const expected = JSON.parse(readFileSync(new URL('../../../fixtures/indicators/expected.json', import.meta.url), 'utf8'));
// 기록 시점의 미완성 마지막 봉은 제외 (gen_expected.py와 같은 입력)
const candles: Candle[] = fx.rows.slice(0, -1).map((r: number[]) => ({
  openTime: r[0], closeTime: r[1]! + 1, open: r[2], high: r[3], low: r[4], close: r[5], volume: r[6],
}));
const closes = candles.map((c) => c.close);

function near(actual: number | null, exp: number, rel: number, label: string) {
  assert.ok(actual !== null, `${label}: null`);
  const err = Math.abs(actual - exp) / Math.max(Math.abs(exp), 1e-12);
  assert.ok(err <= rel, `${label}: ${actual} vs ${exp} (상대 오차 ${err})`);
}

test('P1-3-T1 지표가 독립 구현(Python) 기대값과 허용 오차 안에서 일치한다 (P1-3-R12, R13)', () => {
  assert.equal(candles.length, expected.bars);
  near(sma(closes, 20), expected.sma20, 1e-9, 'SMA20');
  near(sma(closes, 50), expected.sma50, 1e-9, 'SMA50');
  near(ema(closes, 20), expected.ema20, 1e-9, 'EMA20');
  near(rsi(closes), expected.rsi14, 1e-6, 'RSI14');
  const m = macd(closes)!;
  near(m.macd, expected.macd.macd, 1e-6, 'MACD');
  near(m.signal, expected.macd.signal, 1e-6, 'MACD signal');
  near(m.hist, expected.macd.hist, 1e-6, 'MACD hist');
  near(atr(candles), expected.atr14, 1e-6, 'ATR14');
  near(realizedVol(closes, 32), expected.realizedVol32, 1e-6, '변동성');
  const hl = recentHighLow(candles)!;
  assert.equal(hl.high, expected.recentHigh20);
  assert.equal(hl.low, expected.recentLow20);
});

const bar = (i: number, c: number, o = c): Candle => ({ openTime: i * 60_000, closeTime: (i + 1) * 60_000, open: o, high: Math.max(o, c), low: Math.min(o, c), close: c, volume: 1 });

test('P1-3-R2, R14 최소 봉 수보다 적으면 null (0이나 부분 값을 넣지 않음)', () => {
  const few = Array.from({ length: 14 }, (_, i) => 100 + i);
  assert.equal(rsi(few), null);
  assert.equal(sma(few, 20), null);
  assert.equal(macd(Array.from({ length: 33 }, (_, i) => 100 + i)), null);
  assert.notEqual(macd(Array.from({ length: 34 }, (_, i) => 100 + i)), null);
  assert.equal(atr(few.map((c, i) => bar(i, c))), null);
  assert.equal(realizedVol(few, 20), null);
  assert.equal(recentHighLow(few.map((c, i) => bar(i, c))), null);
});

test('P1-3-R3 경계 사례: 하락 없음 RSI 100, 변화 없음 RSI 50·변동성 0', () => {
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  const flat = Array.from({ length: 30 }, () => 100);
  assert.equal(rsi(up), 100);
  assert.equal(rsi(flat), 50);
  assert.equal(realizedVol(flat, 20), 0);
  const ind = computeIndicators(flat.map((c, i) => bar(i, c)), 20, false);
  assert.equal(ind.rsi14, 50);
  assert.equal(ind.atr14, 0);
});

test('P1-3-T4 수정주가로 지표를 계산하고 원시 가격과 섞지 않는다 (P1-3-R9)', () => {
  // 30봉 뒤 2:1 분할: 원시 종가는 200→100으로 반토막, 수정주가는 100으로 이어짐
  const cs: Candle[] = Array.from({ length: 60 }, (_, i) => {
    const raw = i < 30 ? 200 : 100;
    return { ...bar(i, raw), adjClose: 100 };
  });
  const adj = computeIndicators(cs, 20, true);
  assert.equal(adj.basis, 'adjClose');
  assert.equal(adj.sma50, 100);
  assert.equal(adj.rsi14, 50);
  const raw = computeIndicators(cs, 20, false);
  assert.equal(raw.basis, 'close');
  assert.ok(raw.sma50! > 100);
  // 일부 봉에 수정주가가 없으면 섞지 않고 원시 가격으로 계산
  const mixed = computeIndicators(cs.map((c, i) => (i === 5 ? { ...c, adjClose: undefined as unknown as number } : c)), 20, true);
  assert.equal(mixed.basis, 'close');
});
