import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureNet, NetError } from '../../src/core/data/net.ts';
import { collectTicker, demoTicker, parseBinance24h, parseYahooChart, TICKER_ITEMS } from '../../src/core/ticker.ts';
import { TickerService } from '../../src/server/ticker.ts';

const NOW = new Date('2026-10-01T03:00:00.000Z');
const binanceUrl = `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT']))}`;
const yahooUrl = (s: string) => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1d&range=1d`;
const yahooBody = (price: number, prev: number, atSec: number) =>
  JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: price, chartPreviousClose: prev, regularMarketTime: atSec } }] } });
const binanceBody = JSON.stringify([
  { symbol: 'BTCUSDT', lastPrice: '83481.32', priceChangePercent: '0.117', closeTime: NOW.getTime() },
  { symbol: 'ETHUSDT', lastPrice: '3100.5', priceChangePercent: '-1.2', closeTime: NOW.getTime() },
  { symbol: 'SOLUSDT', lastPrice: 'abc', priceChangePercent: '1', closeTime: NOW.getTime() },
]);

test('P0-7-T10 티커 Binance 파싱: 코인 변동률은 24시간 값 그대로, 값이 깨진 종목은 빠진다', () => {
  const coins = TICKER_ITEMS.filter((s) => s.source === 'binance');
  const items = parseBinance24h(binanceBody, coins, NOW);
  assert.deepEqual(items.map((i) => i.id), ['BTC', 'ETH']);
  assert.equal(items[0]!.changePct, 0.117);
  assert.equal(items[0]!.closed, false);
  assert.deepEqual(parseBinance24h('not json', coins, NOW), []);
  assert.deepEqual(parseBinance24h('{}', coins, NOW), []);
});

test('P0-7-T10 티커 Yahoo 파싱: 직전 종가 대비 변동률, 20분 넘게 체결이 없으면 마감 표시', () => {
  const spec = TICKER_ITEMS.find((s) => s.id === 'NVDA')!;
  const live = parseYahooChart(yahooBody(110, 100, NOW.getTime() / 1000 - 60), spec, NOW)!;
  assert.equal(Math.round(live.changePct * 100) / 100, 10);
  assert.equal(live.closed, false);
  const old = parseYahooChart(yahooBody(110, 100, NOW.getTime() / 1000 - 3 * 3600), spec, NOW)!;
  assert.equal(old.closed, true);
  assert.equal(parseYahooChart('{"chart":{"result":null}}', spec, NOW), null);
  assert.equal(parseYahooChart(yahooBody(0, 100, 1), spec, NOW), null);
});

test('P0-7-T10 티커 수집: 실패한 종목은 빠지고 순서는 목록 그대로, 허용 도메인만 쓴다', async () => {
  const responses: Record<string, string | NetError> = { [binanceUrl]: binanceBody };
  for (const s of TICKER_ITEMS.filter((x) => x.source === 'yahoo')) responses[yahooUrl(s.symbol)] = yahooBody(200, 190, NOW.getTime() / 1000);
  responses[yahooUrl('^KS11')] = new NetError('NET_TIMEOUT', 'timeout');
  const net = createFixtureNet(responses);
  const t = await collectTicker(net, NOW);
  const ids = t.items.map((i) => i.id);
  assert.ok(!ids.includes('KOSPI'));
  assert.ok(ids.includes('KOSDAQ'));
  assert.deepEqual(ids, TICKER_ITEMS.map((s) => s.id).filter((id) => ids.includes(id)));
  assert.equal(t.demo, false);
  assert.ok(net.requests.every((u) => u.startsWith('https://api.binance.com/') || u.startsWith('https://query1.finance.yahoo.com/')));
});

test('P0-7-T10 티커 전부 실패하면 빈 목록 (화면은 띠를 숨김)', async () => {
  const t = await collectTicker(createFixtureNet({}), NOW);
  assert.deepEqual(t.items, []);
});

test('P0-7-T10 TickerService: 30초 캐시, 지나면 다시 조회, 데모는 외부 요청 0건', async () => {
  let clock = NOW.getTime();
  const net = createFixtureNet({ [binanceUrl]: binanceBody });
  const s = new TickerService({ net, now: () => new Date(clock) });
  const demo = await s.get(true);
  assert.equal(demo.demo, true);
  assert.deepEqual(demo.items, demoTicker(NOW).items);
  assert.equal(net.requests.length, 0);
  await s.get(false);
  const first = net.requests.length;
  assert.ok(first > 0);
  clock += 29_000;
  await s.get(false);
  assert.equal(net.requests.length, first);
  clock += 2_000;
  await s.get(false);
  assert.equal(net.requests.length, first * 2);
});
