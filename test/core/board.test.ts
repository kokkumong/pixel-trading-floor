import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_ESTIMATE_BADGE, buildBoard, collectBoardSources } from '../../src/core/board.ts';
import { loadDemo } from '../../src/core/demo.ts';
import { registry, replayNet } from '../data-helpers.ts';

function inst(symbol: string) {
  const r = registry.resolve(symbol, 'algorithm');
  if (!r.ok) throw new Error(symbol);
  return r.instrument;
}

test('P1-2-R4 전광판: 코인은 해석된 종목·현물 가격·전일 종가 대비 등락·일봉 차트(MA20/MA50)를 보인다', async () => {
  const { net, at } = replayNet('btc-algorithm');
  const records = await collectBoardSources(net, inst('BTC'));
  const b = buildBoard(inst('BTC'), records, at, false);
  assert.equal(b.instrumentId, 'CRYPTO:BTC');
  assert.match(b.description, /Binance 현물/);
  assert.equal(b.demo, false);
  assert.ok(b.price && b.price.value > 0);
  assert.equal(b.price.currency, 'USDT');
  assert.equal(typeof b.price.changeRatio, 'number');
  assert.ok(b.chart && b.chart.points.length >= 60);
  assert.equal(b.chart.ma20.length, b.chart.points.length);
  assert.equal(b.chart.ma20[18], null);
  assert.equal(typeof b.chart.ma20[19], 'number');
  assert.equal(typeof b.chart.ma50.at(-1), 'number');
  assert.ok(b.chart.high20! >= b.chart.low20!);
  assert.equal(b.multi, null, '한국 종목만 멀티 거래소 전광판');
  // 전광판은 가격과 캔들만 조회한다 (뉴스·공포탐욕·CoinGecko 없음)
  assert.ok(net.requests.every((u) => /binance\.com/.test(u)), net.requests.join('\n'));
});

test('P1-2-R10 한국 종목 멀티 거래소 전광판: 환율·KRX 현물·거래소별 선물·추정 시세 배지와 산출 거래소·시각·괴리', async () => {
  const { net, at } = replayNet('hynix-algorithm');
  const hynix = inst('하이닉스');
  const records = await collectBoardSources(net, hynix);
  const b = buildBoard(hynix, records, at, false);
  assert.equal(b.displayName, 'SK하이닉스');
  assert.equal(b.price?.currency, 'KRW');
  const m = b.multi!;
  assert.ok(m, '멀티 거래소 전광판');
  assert.ok(m.fx && m.fx.rate > 1000);
  assert.ok(m.krxSpot && m.krxSpot.value > 0 && m.krxSpot.usd! > 0);
  assert.deepEqual(m.perps.map((p) => p.exchange), ['binance', 'bybit', 'bitget', 'gate']);
  const bin = m.perps[0]!;
  assert.ok(bin.last! > 0 && bin.krw! > 0);
  assert.equal(typeof bin.fundingRate8h, 'number');
  // 추정값은 직접 시세와 구분해 배지·산출 거래소·산출 시각을 붙인다
  assert.equal(m.estimate.badge, BOARD_ESTIMATE_BADGE);
  assert.equal(BOARD_ESTIMATE_BADGE, '추정 · 직접 체결가 아님');
  assert.equal(m.estimate.computedAt, at.toISOString());
  if (m.estimate.value !== null) assert.ok(m.estimate.exchanges.length >= 3);
  else assert.ok(m.estimate.reason);
  assert.ok(m.estimate.exchanges.every((e) => !e.includes('gate')) || m.estimate.value === null, 'Gate는 시각 미확인이라 추정에 쓰지 않음');
  assert.ok(m.spread && Number.isFinite(m.spread.value));
  assert.ok(m.spread.assumptions.length > 0);
  assert.ok(net.requests.every((u) => !/news\.google|alternative\.me|coingecko/.test(u)));
});

test('P1-2-R10 추정 시세 산출 불가: 거래소 가격이 모자라면 값 없이 이유를 보인다', async () => {
  const { net, at } = replayNet('hynix-algorithm', { fail: ['bybit', 'bitget'] });
  const hynix = inst('하이닉스');
  const b = buildBoard(hynix, await collectBoardSources(net, hynix), at, false);
  assert.equal(b.multi!.estimate.value, null);
  assert.match(b.multi!.estimate.reason!, /거래소 가격/);
  assert.equal(b.multi!.perps.find((p) => p.exchange === 'bybit')!.status, 'failed');
});

test('P1-8-R5 데모 전광판은 녹화 fixture 기록과 녹화 시각으로 만든다', () => {
  const s = loadDemo('algorithm');
  const b = buildBoard(inst(s.symbol), s.records, new Date(s.collectedAt), true);
  assert.equal(b.demo, true);
  assert.ok(b.price && b.chart);
  assert.equal(b.builtAt, s.collectedAt);
});

test('P1-8-R5 데모 스캘핑 기록(무기한 15분봉)만 있어도 전광판을 만든다', () => {
  const s = loadDemo('scalp');
  const b = buildBoard(inst(s.symbol), s.records, new Date(s.collectedAt), true);
  assert.ok(b.price);
  assert.equal(b.chart?.interval, '15m');
});

test('전광판: 가격 소스가 모두 실패하면 가격 없이 경고를 보인다', async () => {
  const { net, at } = replayNet('btc-algorithm', { fail: ['binance.com'] });
  const b = buildBoard(inst('BTC'), await collectBoardSources(net, inst('BTC')), at, false);
  assert.equal(b.price, null);
  assert.equal(b.chart, null);
  assert.ok(b.warnings.length > 0);
});
