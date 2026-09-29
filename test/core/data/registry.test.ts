import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InstrumentRegistry, normalizeSymbolInput, type UsQuote } from '../../../src/core/data/registry.ts';

const reg = new InstrumentRegistry();
const id = (input: string, mode: 'algorithm' | 'scalp' = 'algorithm') => {
  const r = reg.resolve(input, mode);
  return r.ok ? r.instrument.instrumentId : `FAIL:${r.reason}`;
};

test('P1-2-T1 가이드의 모든 입력 예시가 기대한 instrumentId로 해석된다', () => {
  for (const s of ['하이닉스', 'SK하이닉스', 'SKHYNIX', '000660', 'SKHYNIX-USDT', 'skhynix', ' sk하이닉스 ']) assert.equal(id(s), 'KR:000660', s);
  for (const s of ['삼성전자', '삼성', 'SAMSUNG', '005930', 'SAMSUNG-USDT']) assert.equal(id(s), 'KR:005930', s);
  for (const s of ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'btc', '비트코인', 'BTCUSDT', 'BTC-USDT']) assert.match(id(s), /^CRYPTO:/, s);
  const coins = reg.all().filter((i) => i.assetClass === 'crypto');
  assert.equal(coins.length, 36, '가이드: 코인 36종');
  for (const c of coins) assert.equal(id(c.aliases[0]!, 'scalp'), c.instrumentId);
});

test('P1-2-T2 부분 입력은 분석을 시작하지 않고 후보만 제안한다', () => {
  const r = reg.resolve('하이닉', 'algorithm');
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.reason === 'NOT_FOUND');
  assert.deepEqual(!r.ok && r.candidates.map((c) => c.displayName), ['SK하이닉스']);
});

const fakeLookup = (quotes: Record<string, UsQuote>) => async (t: string) => quotes[t] ?? null;
const tsla: UsQuote = { symbol: 'TSLA', quoteType: 'EQUITY', exchange: 'NMS', name: 'Tesla, Inc.' };

test('P1-2-T3 TSLA + scalp는 E-UNSUPPORTED-SYMBOL', async () => {
  const r = await reg.resolveWithLookup('TSLA', 'scalp', fakeLookup({ TSLA: tsla }));
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.code === 'E-UNSUPPORTED-SYMBOL' && r.reason === 'MODE_NOT_SUPPORTED');
  assert.ok(!r.ok && r.message.includes('알고리즘 모드만'));
});

test('P1-2-R5 미국 주식은 보통주·ETF이고 NASDAQ·NYSE·NYSE American일 때만 받는다', async () => {
  const r = await new InstrumentRegistry().resolveWithLookup('TSLA', 'algorithm', fakeLookup({ TSLA: tsla }));
  assert.ok(r.ok);
  assert.equal(r.instrument.instrumentId, 'US:TSLA');
  assert.equal(r.description, 'Tesla, Inc. (TSLA) · NASDAQ 현물 · USD');
  const arca = await new InstrumentRegistry().resolveWithLookup('SPY', 'algorithm', fakeLookup({ SPY: { symbol: 'SPY', quoteType: 'ETF', exchange: 'PCX', name: 'SPDR' } }));
  assert.equal(arca.ok, false);
  const fund = await new InstrumentRegistry().resolveWithLookup('ABCD', 'algorithm', fakeLookup({ ABCD: { symbol: 'ABCD', quoteType: 'MUTUALFUND', exchange: 'NAS', name: 'x' } }));
  assert.equal(fund.ok, false);
  // 형식이 다르면 조회하지 않는다
  let called = false;
  await new InstrumentRegistry().resolveWithLookup('TOOLONG', 'algorithm', async () => ((called = true), null));
  assert.equal(called, false);
});

test('P1-7-T1 위험한 종목 입력은 정규화 전에 거부된다', () => {
  for (const s of ['BTC; del /q *', '../../x', '<script>', 'A'.repeat(33), 'BTC\u0000', '$(rm -rf)']) {
    const r = normalizeSymbolInput(s);
    assert.equal(r.ok, false, s);
    const res = reg.resolve(s, 'algorithm');
    assert.ok(!res.ok && res.reason === 'INVALID_INPUT', s);
  }
  assert.equal(normalizeSymbolInput(123).ok, false);
});

test('P1-2-R4 분석 시작 전 해석 결과 표기', () => {
  const a = reg.resolve('하이닉스', 'algorithm');
  const s = reg.resolve('하이닉스', 'scalp');
  assert.ok(a.ok && s.ok);
  assert.equal(a.description, 'SK하이닉스 · KRX 현물 · KRW');
  assert.equal(s.description, 'SK하이닉스 · Binance USDT 무기한');
  assert.equal(a.marketType, 'spot');
  assert.equal(s.marketType, 'perpetual');
});
