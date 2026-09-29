import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarCoverageWarnings, isTradingDay, latestCompletedSession, marketStatus, zonedTime } from '../../../src/core/data/calendar.ts';
import { checkCandles, type Candle } from '../../../src/core/data/candles.ts';

test('P1-3-T2 한국 공휴일과 미국 조기 폐장일에 MARKET OPEN이 잘못 표시되지 않는다', () => {
  // 설 연휴 2026-02-17 10:00 KST
  assert.equal(marketStatus('KRX', new Date('2026-02-17T01:00:00Z')).state, 'CLOSED');
  assert.match(marketStatus('KRX', new Date('2026-02-17T01:00:00Z')).label, /설날/);
  // 제헌절 (2026년 공휴일 재지정)
  assert.equal(marketStatus('KRX', new Date('2026-07-17T01:00:00Z')).state, 'CLOSED');
  // 평일 장중
  assert.equal(marketStatus('KRX', new Date('2026-09-29T01:00:00Z')).label, 'MARKET OPEN');
  // 수능일 09:30 KST는 아직 개장 전 (10:00 개장)
  assert.equal(marketStatus('KRX', new Date('2026-11-19T00:30:00Z')).state, 'CLOSED');
  assert.equal(marketStatus('KRX', new Date('2026-11-19T07:15:00Z')).state, 'OPEN'); // 16:15 KST, 16:30 마감
  // 미국 추수감사절 다음 날 13:00 ET 조기 폐장 (EST = UTC-5)
  assert.equal(marketStatus('US', new Date('2026-11-27T17:30:00Z')).state, 'OPEN');
  assert.equal(marketStatus('US', new Date('2026-11-27T18:30:00Z')).state, 'CLOSED');
  assert.equal(marketStatus('US', new Date('2026-12-25T15:00:00Z')).state, 'CLOSED');
});

test('P1-3-R7 포함 기간 밖은 장 상태를 추측하지 않는다', () => {
  assert.equal(isTradingDay('KRX', '2027-01-04'), null);
  assert.equal(marketStatus('KRX', new Date('2027-01-04T01:00:00Z')).label, '장 상태 확인 불가');
  assert.equal(marketStatus('CRYPTO_24_7', new Date()).state, 'OPEN');
});

test('P1-3-R8 서머타임 전환을 반영해 UTC로 바꾼다', () => {
  assert.equal(zonedTime('2026-03-06', '09:30', 'America/New_York').toISOString(), '2026-03-06T14:30:00.000Z');
  assert.equal(zonedTime('2026-03-09', '09:30', 'America/New_York').toISOString(), '2026-03-09T13:30:00.000Z');
  assert.equal(zonedTime('2026-09-29', '15:30', 'Asia/Seoul').toISOString(), '2026-09-29T06:30:00.000Z');
});

test('가장 최근에 끝난 세션은 휴장일을 건너뛴다', () => {
  const s = latestCompletedSession('KRX', new Date('2026-09-28T00:00:00Z')); // 월 09:00 KST, 추석 연휴 뒤
  assert.equal(s.date, '2026-09-23');
  assert.equal(s.assumed, false);
});

const M = 60_000;
const c = (i: number, close: number, extra: Partial<Candle> = {}): Candle => ({
  openTime: i * 15 * M, closeTime: (i + 1) * 15 * M, open: close, high: close + 1, low: close - 1, close, volume: 10, ...extra,
});
const opts = (now: number) => ({ intervalMs: 15 * M, now: new Date(now), calendar: 'CRYPTO_24_7' as const, label: 'x' });

test('P1-3-R4 캔들 무결성: 역순 정렬, 중복은 마지막 값, OHLC 모순 제외', () => {
  const input = [c(2, 102), c(0, 100), c(1, 101), c(1, 111), c(3, 103, { low: 104 }), c(4, 104, { volume: -1 })];
  const r = checkCandles(input, opts(10 * 15 * M));
  assert.deepEqual(r.candles.map((x) => x.close), [100, 111, 102]);
  assert.ok(r.warnings.some((w) => w.includes('역순')));
  assert.ok(r.warnings.some((w) => w.includes('중복')));
  assert.ok(r.warnings.some((w) => w.includes('OHLC 모순')));
});

test('P1-3-R4 누락 비율이 5%를 넘으면 partial', () => {
  const full = Array.from({ length: 100 }, (_, i) => c(i, 100));
  assert.equal(checkCandles(full, opts(200 * 15 * M)).partial, false);
  const holes = full.filter((_, i) => i % 10 !== 5); // 10% 누락
  const r = checkCandles(holes, opts(200 * 15 * M));
  assert.equal(r.partial, true);
  assert.ok(r.missingRatio > 0.05);
});

test('P1-3-T3 마지막 봉이 미완성이면 지표 계산에서 빠지고 incomplete로 표시된다', () => {
  const list = Array.from({ length: 10 }, (_, i) => c(i, 100 + i));
  const r = checkCandles(list, opts(9 * 15 * M + 5 * M)); // 10번째 봉 진행 중
  assert.equal(r.candles.length, 9);
  assert.equal(r.current?.incomplete, true);
  assert.equal(r.current?.close, 109);
});

test('주식 일봉 누락은 거래일 기준으로 센다 (휴장일은 누락이 아님)', () => {
  const day = (d: string, close: number): Candle => {
    const t = Date.parse(d + 'T00:00:00Z');
    return { openTime: t, closeTime: t + 6.5 * 3_600_000, open: close, high: close, low: close, close, volume: 1 };
  };
  // 9/23(수) 다음 거래일은 추석 연휴 뒤 9/28(월)
  const r = checkCandles([day('2026-09-22', 1), day('2026-09-23', 1), day('2026-09-28', 1)], {
    intervalMs: 86_400_000, now: new Date('2026-10-01T00:00:00Z'), calendar: 'KRX', label: 'krx',
  });
  assert.equal(r.missingRatio, 0);
});

test('달력 포함 기간이 30일 안에 끝나면 진단 경고 (P1 명세 v0.2 8.2)', () => {
  assert.deepEqual(calendarCoverageWarnings(new Date('2026-09-29T00:00:00Z')), []);
  const w = calendarCoverageWarnings(new Date('2026-12-10T00:00:00Z'));
  assert.equal(w.length, 1);
  assert.match(w[0]!, /^KRX 달력 포함 기간이 21일 뒤/);
  assert.match(calendarCoverageWarnings(new Date('2027-01-05T00:00:00Z'))[0]!, /KRX 달력 포함 기간\(2026-12-31\)이 지났습니다/);
});
