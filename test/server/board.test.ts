import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardService } from '../../src/server/board.ts';
import { replayNet } from '../data-helpers.ts';

test('P1-8-T1 데모 전광판: 외부 요청 0건, 녹화 종목만 허용', async () => {
  const { net } = replayNet('btc-algorithm');
  const s = new BoardService({ net });
  const r = await s.get('BTC', true);
  assert.ok(r.ok);
  assert.equal(r.board.demo, true);
  assert.equal(net.requests.length, 0);
  const other = await s.get('ETH', true);
  assert.ok(!other.ok);
  assert.equal(other.code, 'E-DEMO');
  assert.equal(net.requests.length, 0);
});

test('전광판 실전: 같은 종목은 15초 동안 캐시하고, 지나면 다시 조회한다', async () => {
  const { net, at } = replayNet('btc-algorithm');
  const clock = { t: at.getTime() };
  const s = new BoardService({ net, now: () => new Date(clock.t) });
  const [a, b] = await Promise.all([s.get('BTC', false), s.get('btc', false)]);
  assert.ok(a.ok && b.ok);
  assert.equal(a.board.demo, false);
  const first = net.requests.length;
  assert.ok(first > 0);
  clock.t += 10_000;
  await s.get('BTC', false);
  assert.equal(net.requests.length, first, '캐시 안에서는 다시 조회하지 않음');
  clock.t += 6_000;
  await s.get('BTC', false);
  assert.ok(net.requests.length > first);
});

test('P1-7-T1 전광판 입력 검증: 허용되지 않은 문자는 조회 전에 거부, 모르는 종목은 후보와 함께 400', async () => {
  const { net } = replayNet('btc-algorithm');
  const s = new BoardService({ net });
  const bad = await s.get('BTC; del /q *', false);
  assert.ok(!bad.ok);
  assert.equal(bad.code, 'E-INPUT');
  const hynix = await s.get('하이닉', false);
  assert.ok(!hynix.ok);
  assert.equal(hynix.code, 'E-UNSUPPORTED-SYMBOL');
  assert.deepEqual(hynix.candidates?.map((c) => c.displayName), ['SK하이닉스']);
  assert.equal(net.requests.length, 0);
});
