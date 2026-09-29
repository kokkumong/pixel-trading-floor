import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetFundingCache } from '../../../src/core/data/adapters.ts';
import { createBlockedNet } from '../../../src/core/data/net.ts';
import { collectSnapshot, hashSnapshot } from '../../../src/core/data/snapshot.ts';
import { registry, replaySnapshot } from '../../data-helpers.ts';

const src = (snap: Awaited<ReturnType<typeof replaySnapshot>>['snap'], id: string) => snap.sources.find((s) => s.id === id)!;

test('녹화 응답으로 모드별 스냅샷을 만든다', async () => {
  for (const name of ['btc-scalp', 'btc-algorithm', 'hynix-algorithm', 'hynix-scalp', 'tsla-algorithm']) {
    const { snap } = await replaySnapshot(name);
    assert.notEqual(snap.dataQuality.status, 'INSUFFICIENT_DATA', `${name}: ${snap.dataQuality.warnings.join(' / ')}`);
    assert.ok(snap.derived.indicators?.rsi14 !== null, name);
    assert.equal(snap.schemaVersion, 'snapshot/2');
  }
});

test('P0-4-R1 스냅샷 해시는 내용으로 다시 계산해도 같고, 내용이 바뀌면 달라진다', async () => {
  const { snap } = await replaySnapshot('btc-scalp');
  assert.match(snap.snapshotHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(hashSnapshot(snap), snap.snapshotHash);
  const again = await replaySnapshot('btc-scalp');
  assert.equal(again.snap.snapshotHash, snap.snapshotHash);
  const tampered = structuredClone(snap);
  tampered.derived.indicators!.rsi14 = 99;
  assert.notEqual(hashSnapshot(tampered), snap.snapshotHash);
});

test('P0-4-T2 스캘핑에서 무기한 가격 소스가 실패하면 INSUFFICIENT_DATA', async () => {
  const { snap } = await replaySnapshot('btc-scalp', { fail: ['ticker/price', 'premiumIndex'] });
  assert.equal(snap.dataQuality.status, 'INSUFFICIENT_DATA');
  assert.ok(snap.dataQuality.warnings.some((w) => w.includes('필수 소스 binance.perp.price')));
});

test('P0-4-T3 뉴스 소스만 실패하면 PARTIAL_DATA로 진행하고 경고가 남는다', async () => {
  const { snap } = await replaySnapshot('tsla-algorithm', { fail: ['news.google.com'] });
  assert.equal(snap.dataQuality.status, 'PARTIAL_DATA');
  assert.ok(snap.dataQuality.warnings.some((w) => w.includes('news.google')));
  assert.equal(src(snap, 'news.google').usable, false);
});

test('P0-4-T4 추정가만 있고 직접 시세가 없으면 판정 기준을 충족하지 못한다', async () => {
  const { snap } = await replaySnapshot('hynix-scalp', { fail: ['fapi.binance.com/fapi/v1/ticker/price', 'premiumIndex'] });
  assert.equal(snap.dataQuality.status, 'INSUFFICIENT_DATA');
  const est = src(snap, 'tapbit.perp.estimate');
  assert.equal(est.estimated, true);
  assert.equal(est.freshness, 'ESTIMATED');
  assert.equal(est.usable, false); // P0-4-R3: 추정값은 사용 불가
});

test('P0-4-R2 공급자가 시각을 주지 않으면 UNKNOWN_TIME, fetchedAt으로 대체하지 않는다', async () => {
  const { snap } = await replaySnapshot('hynix-scalp');
  const gate = src(snap, 'gate.perp.price');
  assert.equal(gate.observedAt, null);
  assert.equal(gate.freshness, 'UNKNOWN_TIME');
  assert.equal(gate.usable, false);
});

test('P0-4.4 TTL이 지나면 필수 소스가 만료되어 INSUFFICIENT_DATA', async () => {
  const { snap } = await replaySnapshot('btc-scalp', { shiftMs: 60_000 }); // 1분 뒤: 가격 TTL 30초 초과
  assert.equal(src(snap, 'binance.perp.price').stale, true);
  assert.equal(snap.dataQuality.status, 'INSUFFICIENT_DATA');
});

test('캔들 봉 수가 최소 기준보다 적으면 필수 소스가 부분 데이터로 처리된다', async () => {
  const { snap } = await replaySnapshot('btc-scalp', {
    patch: (url, body) => (url.includes('klines') ? JSON.stringify(JSON.parse(body).slice(-50)) : body),
  });
  assert.equal(src(snap, 'binance.perp.candles.15m').status, 'partial');
  assert.equal(snap.dataQuality.status, 'INSUFFICIENT_DATA');
});

test('한국 종목: 무기한↔KRX 괴리는 환율 소스를 기록하고, 추정가는 표시 전용', async () => {
  const { snap } = await replaySnapshot('hynix-algorithm');
  const spread = snap.derived.spreads.find((s) => s.name === 'perpVsKrx');
  assert.ok(spread);
  assert.equal(spread.fxSourceRef, 'yahoo.fx.usdkrw');
  assert.ok(Math.abs(spread.value) < 0.05);
  assert.equal(snap.derived.indicators?.basis, 'adjClose');
});

test('P1-8-R2 데모 네트워크로는 외부 요청이 한 건도 나가지 않고 모든 소스가 실패로 기록된다', async () => {
  resetFundingCache();
  const res = registry.resolve('BTC', 'scalp');
  assert.ok(res.ok);
  const snap = await collectSnapshot(createBlockedNet(), {
    jobId: 'j', mode: 'scalp', symbolInput: 'BTC', instrument: res.instrument, marketType: res.marketType,
    registryVersion: registry.version, requestedAt: new Date(),
  });
  assert.equal(snap.dataQuality.status, 'INSUFFICIENT_DATA');
  assert.ok(snap.sources.every((s) => s.status === 'failed' && s.error?.includes('데모 모드')));
});
