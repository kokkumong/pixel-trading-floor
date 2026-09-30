import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createEngine } from '../../src/core/job/engine.ts';
import { JobStore } from '../../src/core/job/store.ts';
import { emptyBook, validateBook, type PositionBook } from '../../src/core/position/book.ts';
import { buildPositionContext, derive } from '../../src/core/position/context.ts';
import { bookPath, readBook, writeBook } from '../../src/core/position/store.ts';
import { registry, replayAcquirer, replaySnapshot } from '../data-helpers.ts';

const known = (id: string) => registry.get(id) !== undefined;
const NOW = new Date('2026-09-29T06:00:00Z');
const ID1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function book(positions: Record<string, unknown>[], over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 'positions/1', updatedAt: NOW.toISOString(),
    account: { equity: { USDT: 1000 }, riskPerTradePercent: 1 },
    positions, ...over,
  };
}
const perpLong = (over: Record<string, unknown> = {}) => ({
  id: ID1, instrumentId: 'CRYPTO:BTC', marketType: 'perpetual', side: 'LONG', avgEntryPrice: 80000, quantity: 0.1,
  leverage: 10, marginMode: 'isolated', liquidationPrice: 72500, stopLoss: 78000, targets: [90000], ...over,
});
const tempRoot = () => mkdtempSync(join(tmpdir(), 'floor-pos-'));
const valid = (raw: unknown): PositionBook => {
  const r = validateBook(raw, known);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  return r.book;
};

test('P2-1-T1 스키마 위반 입력은 필드별 오류로 거절된다', () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ['음수 수량', perpLong({ quantity: -1 }), '$.positions[0].quantity'],
    ['0 평단', perpLong({ avgEntryPrice: 0 }), '$.positions[0].avgEntryPrice'],
    ['현물 숏', { instrumentId: 'CRYPTO:BTC', marketType: 'spot', side: 'SHORT', avgEntryPrice: 1, quantity: 1 }, '$.positions[0].side'],
    ['현물 레버리지', { instrumentId: 'CRYPTO:BTC', marketType: 'spot', side: 'LONG', avgEntryPrice: 1, quantity: 1, leverage: 2 }, '$.positions[0].leverage'],
    ['무기한 레버리지 없음', perpLong({ leverage: null }), '$.positions[0].leverage'],
    ['레버리지 21', perpLong({ leverage: 21 }), '$.positions[0].leverage'],
    ['레버리지 소수', perpLong({ leverage: 2.5 }), '$.positions[0].leverage'],
    ['롱 청산가가 평단 위', perpLong({ liquidationPrice: 85000 }), '$.positions[0].liquidationPrice'],
    ['숏 청산가가 평단 아래', perpLong({ side: 'SHORT', liquidationPrice: 70000 }), '$.positions[0].liquidationPrice'],
    ['미등록 종목', perpLong({ instrumentId: 'CRYPTO:NOPE' }), '$.positions[0].instrumentId'],
    ['메모 200자 초과', perpLong({ note: 'x'.repeat(201) }), '$.positions[0].note'],
    ['목표가 4개', perpLong({ targets: [1, 2, 3, 4] }), '$.positions[0].targets'],
  ];
  for (const [name, p, path] of cases) {
    const r = validateBook(book([p]), known);
    assert.equal(r.ok, false, name);
    assert.ok(!r.ok && r.errors.some((e) => e.path === path), `${name}: ${JSON.stringify(!r.ok && r.errors)}`);
  }
  // 중복 매칭 키 (헤지 미지원, P2-1-R3)
  const dup = validateBook(book([perpLong(), perpLong({ id: undefined, side: 'SHORT', liquidationPrice: 90000 })]), known);
  assert.ok(!dup.ok && dup.errors.some((e) => e.path === '$.positions[1].instrumentId' && /이미 있습니다/.test(e.message)));
  // 총 자산·한도 범위
  const acc = validateBook(book([], { account: { equity: { KRW: -5 }, riskPerTradePercent: 6 } }), known);
  assert.ok(!acc.ok && acc.errors.some((e) => e.path === '$.account.equity.KRW') && acc.errors.some((e) => e.path === '$.account.riskPerTradePercent'));
  // 손절은 평단 기준 방향을 강제하지 않는다 (트레일링 손절 허용)
  valid(book([perpLong({ stopLoss: 82000 })]));
});

test('P2-1-T1 빠진 선택 필드는 기본값, 새 포지션은 id를 받는다', () => {
  const b = valid(book([{ instrumentId: 'CRYPTO:BTC', marketType: 'spot', side: 'LONG', avgEntryPrice: 80000, quantity: 0.5 }], { account: {} }));
  const p = b.positions[0]!;
  assert.match(p.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual([p.leverage, p.marginMode, p.liquidationPrice, p.stopLoss, p.targets, p.openedAt, p.note], [null, null, null, null, [], null, '']);
  assert.deepEqual(b.account, { equity: { KRW: null, USD: null, USDT: null }, riskPerTradePercent: 1 });
});

test('P2-1-T1 검증 실패는 저장하지 않고, 손으로 고친 파일도 읽을 때 같은 검증을 받는다', () => {
  const root = tempRoot();
  assert.equal(readBook(root, known).status, 'missing');
  writeBook(root, valid(book([perpLong()])));
  writeFileSync(bookPath(root), JSON.stringify(book([perpLong({ quantity: -1 })])));
  const r = readBook(root, known);
  assert.equal(r.status, 'invalid');
  assert.ok(r.status === 'invalid' && r.errors[0]!.path === '$.positions[0].quantity');
  writeFileSync(bookPath(root), '{ broken');
  assert.equal(readBook(root, known).status, 'invalid');
});

test('P2-1-T2 저장은 원자적이고 0600이며 직전 버전 .bak을 남긴다', () => {
  const root = tempRoot();
  const first = valid(book([perpLong()]));
  writeBook(root, first);
  assert.equal(statSync(bookPath(root)).mode & 0o777, 0o600);
  assert.equal(existsSync(`${bookPath(root)}.bak`), false);

  const second = valid(book([perpLong({ quantity: 0.2 })]));
  writeBook(root, second);
  assert.equal(JSON.parse(readFileSync(`${bookPath(root)}.bak`, 'utf8')).positions[0].quantity, 0.1);
  assert.equal(statSync(`${bookPath(root)}.bak`).mode & 0o777, 0o600);

  // rename 직전에 멈추면 기존 파일이 그대로다
  assert.throws(() => writeBook(root, valid(book([perpLong({ quantity: 0.3 })])), { beforeRename: () => { throw new Error('crash'); } }));
  const r = readBook(root, known);
  assert.ok(r.status === 'ok' && r.book.positions[0]!.quantity === 0.2);
  assert.deepEqual(execFileSync('ls', ['-A', join(root, '.floor')], { encoding: 'utf8' }).trim().split('\n').sort(), ['positions.json', 'positions.json.bak']);
});

test('P2 3.2 파생 값: 손익률·R·손절·청산 거리·비중·열린 리스크', () => {
  const p = { ...valid(book([perpLong()])).positions[0]! };
  const d = derive(p, 84000, 10000);
  assert.deepEqual(d, {
    unrealizedPnlPercent: 5, unrealizedPnlPercentLeveraged: 50, rMultiple: 2,
    stopDistancePercent: 7.14, liquidationDistancePercent: 13.69, positionWeightPercent: 84, openRiskPercent: 2,
  });
  // 숏: 가격이 오르면 손실, 이미 손절을 넘으면 거리 음수
  const s = derive({ ...p, side: 'SHORT', liquidationPrice: 88000, stopLoss: 82000 }, 83000, null);
  assert.equal(s.unrealizedPnlPercent, -3.75);
  assert.equal(s.rMultiple, -1.5);
  assert.equal(s.stopDistancePercent, -1.2);
  assert.equal(s.liquidationDistancePercent, 6.02);
  assert.equal(s.positionWeightPercent, null);
  // 손절 없음 → R·손절 거리·열린 리스크 null. 수익권 손절 → 열린 리스크 0
  const n = derive({ ...p, stopLoss: null }, 84000, 10000);
  assert.deepEqual([n.rMultiple, n.stopDistancePercent, n.openRiskPercent], [null, null, null]);
  assert.equal(derive({ ...p, stopLoss: 81000 }, 84000, 10000).openRiskPercent, 0);
});

test('P2-1-T3 같은 종목·다른 시장 포지션은 쓰이지 않고 한 줄만 남는다', async () => {
  const { snap } = await replaySnapshot('btc-algorithm'); // BTC 현물 분석
  const read = { status: 'ok' as const, book: valid(book([perpLong()])) };
  const ctx = buildPositionContext(read, snap, NOW);
  assert.equal(ctx.position, null);
  assert.equal(ctx.derived, null);
  assert.deepEqual(ctx.otherMarkets, [{ marketType: 'perpetual', side: 'LONG' }]);
  assert.deepEqual(ctx.notes, ['다른 시장 보유 있음: 비트코인 (BTC) 무기한']);

  const { snap: perp } = await replaySnapshot('btc-scalp'); // BTC 무기한 분석 → 매칭
  const hit = buildPositionContext(read, perp, NOW);
  assert.equal(hit.position?.id, ID1);
  assert.equal('note' in hit.position!, false);
  assert.deepEqual(hit.price, { value: 83200.1, kind: 'mark', sourceRef: 'binance.perp.price' });
  assert.equal(hit.derived?.unrealizedPnlPercent, 4);
  assert.deepEqual(hit.account, { currency: 'USDT', equity: 1000, riskPerTradePercent: 1 });
  assert.deepEqual(hit.notes, []);
});

test('P2-1-R4·R9 총 자산 없음·오래된 북·파일 오류 경고', async () => {
  const { snap } = await replaySnapshot('btc-scalp');
  const old = valid(book([perpLong()], { updatedAt: '2026-09-27T05:00:00Z', account: { equity: { KRW: 1e7 } } }));
  const ctx = buildPositionContext({ status: 'ok', book: old }, snap, NOW);
  assert.deepEqual(ctx.warnings, ['NO_EQUITY', 'STALE_BOOK']);
  assert.deepEqual(ctx.notes, ['보유 정보가 49시간 전 기준']);
  assert.equal(ctx.derived?.positionWeightPercent, null);

  const bad = buildPositionContext({ status: 'invalid', book: null, errors: [] }, snap, NOW);
  assert.deepEqual([bad.position, bad.warnings], [null, ['BOOK_INVALID']]);
  const none = buildPositionContext({ status: 'missing', book: null }, snap, NOW);
  assert.deepEqual([none.position, none.warnings, none.notes], [null, [], []]);
});

test('P2-1-T4 분석 중 포지션 북을 바꿔도 작업의 positionContext는 그대로다', async () => {
  const root = tempRoot();
  writeBook(root, valid(book([perpLong()])));
  const store = new JobStore(join(root, 'jobs'));
  const r = replayAcquirer('btc-scalp');
  let reads = 0;
  const engine = createEngine({ store, now: () => r.at, positions: () => { reads++; return readBook(root, known); } });
  // 수집 도중에 북을 바꾼다
  const acquirer = { ...r.acquirer, collect: async (...a: Parameters<typeof r.acquirer.collect>) => {
    writeBook(root, valid(book([perpLong({ quantity: 9 })])));
    return r.acquirer.collect(...a);
  } };
  const job = await engine.createJob({ idempotencyKey: 'k-pos-1', mode: 'scalp', symbolInput: 'BTC', interface: 'web' }, acquirer);
  assert.equal(reads, 1);
  assert.equal(job.record.positionContext?.position?.quantity, 0.1);
  writeBook(root, valid(book([])));
  assert.equal(engine.openJob(job.record.jobId).record.positionContext?.position?.quantity, 0.1);

  // 강제 방향·데모는 포지션을 읽지 않는다 (D23, P2-8)
  const f = await engine.createJob({ idempotencyKey: 'k-pos-2', mode: 'forced_direction', symbolInput: 'BTC', interface: 'web' }, replayAcquirer('btc-scalp').acquirer);
  assert.equal(f.record.positionContext, null);
  assert.equal(reads, 1);
});

test('P2-5-T1 .floor/·jobs/·reports/는 git이 무시한다', () => {
  for (const p of ['.floor/positions.json', '.floor/positions.json.bak', 'jobs/x/job.json', 'reports/a.json']) {
    assert.equal(execFileSync('git', ['check-ignore', p], { encoding: 'utf8' }).trim(), p);
  }
});

test('P2-1 emptyBook은 검증을 통과한다', () => {
  valid(emptyBook(NOW));
});
