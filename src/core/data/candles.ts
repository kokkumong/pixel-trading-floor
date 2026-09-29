// 캔들 무결성 검사 (P1 명세 3.2). 지표 계산 전에 정렬·중복·누락·모순·이상치·미완성 봉을 처리한다.
import { addDays, isTradingDay } from './calendar.ts';
import type { CalendarId } from './registry.ts';

export interface Candle {
  openTime: number; // ms UTC
  closeTime: number; // ms UTC (봉 종료 시각, 이 시각 이후면 완성)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose?: number; // 주식 일봉 수정주가 (P1-3-R9)
  incomplete?: boolean;
}

export interface IntegrityResult {
  candles: Candle[]; // 완성 봉만, 시각 오름차순 (지표 계산용)
  current: Candle | null; // 미완성 현재 봉 (incomplete: true)
  warnings: string[];
  missingRatio: number;
  partial: boolean; // 누락 비율 > 5%
}

export const MISSING_RATIO_LIMIT = 0.05;
const DAY = 86_400_000;

export function checkCandles(
  input: readonly Candle[],
  opts: { intervalMs: number; now: Date; calendar: CalendarId; label: string; atr?: number | null },
): IntegrityResult {
  const warnings: string[] = [];
  const w = (m: string) => warnings.push(`${opts.label}: ${m}`);

  let list = [...input];
  // 시각 역순 → 정렬 후 경고
  if (list.some((c, i) => i > 0 && c.openTime < list[i - 1]!.openTime)) {
    list.sort((a, b) => a.openTime - b.openTime);
    w('시각 역순 봉을 정렬함');
  }
  // 같은 시각 중복 → 마지막 값만
  const dedup = new Map<number, Candle>();
  for (const c of list) dedup.set(c.openTime, c);
  if (dedup.size !== list.length) w(`같은 시각 중복 ${list.length - dedup.size}개 제거 (마지막 값 유지)`);
  list = [...dedup.values()].sort((a, b) => a.openTime - b.openTime);

  // OHLC 모순, 음수 거래량, 비정상 숫자 → 제외
  const valid = list.filter((c) => {
    const nums = [c.open, c.high, c.low, c.close, c.volume];
    const ok = nums.every(Number.isFinite) && c.low > 0 && c.volume >= 0
      && c.low <= Math.min(c.open, c.close) && c.high >= Math.max(c.open, c.close) && c.high >= c.low;
    return ok;
  });
  if (valid.length !== list.length) w(`OHLC 모순·음수 거래량 봉 ${list.length - valid.length}개 제외`);

  // 미완성 현재 봉 분리 (P1-3-R5)
  let current: Candle | null = null;
  const last = valid[valid.length - 1];
  if (last && last.closeTime > opts.now.getTime()) {
    current = { ...last, incomplete: true };
    valid.pop();
  }

  // 누락 봉
  let expected = 0;
  let missing = 0;
  for (let i = 1; i < valid.length; i++) {
    const gap = expectedBetween(valid[i - 1]!.openTime, valid[i]!.openTime, opts.intervalMs, opts.calendar);
    expected += gap.expected;
    missing += gap.missing;
  }
  const missingRatio = expected > 0 ? missing / expected : 0;
  if (missing > 0) w(`누락 봉 ${missing}개 (${(missingRatio * 100).toFixed(1)}%)`);

  // 이상치: 한 봉 수익률 절댓값 > 10 × ATR (가격 대비). 다른 공급자 확인은 호출자 몫, 여기서는 경고만
  if (opts.atr && opts.atr > 0) {
    for (let i = 1; i < valid.length; i++) {
      const move = Math.abs(valid[i]!.close - valid[i - 1]!.close);
      if (move > 10 * opts.atr) w(`이상치 의심 봉 ${new Date(valid[i]!.openTime).toISOString()}`);
    }
  }

  return { candles: valid, current, warnings, missingRatio, partial: missingRatio > MISSING_RATIO_LIMIT };
}

/** 두 봉 사이에 있어야 할 봉 수와 빠진 봉 수. 주식 일봉은 거래일 기준 (P1-3-R4) */
function expectedBetween(prevOpen: number, nextOpen: number, intervalMs: number, cal: CalendarId): { expected: number; missing: number } {
  if (cal === 'CRYPTO_24_7' || intervalMs !== DAY) {
    const steps = Math.round((nextOpen - prevOpen) / intervalMs);
    return { expected: steps, missing: Math.max(0, steps - 1) };
  }
  // 주식 일봉: 두 날짜 사이의 거래일 수 (포함 기간 밖은 평일로 가정)
  let d = new Date(prevOpen).toISOString().slice(0, 10);
  const end = new Date(nextOpen).toISOString().slice(0, 10);
  let between = 0;
  for (d = addDays(d, 1); d < end; d = addDays(d, 1)) {
    const t = isTradingDay(cal, d);
    const wd = new Date(d + 'T00:00:00Z').getUTCDay();
    if (t ?? (wd !== 0 && wd !== 6)) between++;
  }
  return { expected: between + 1, missing: between };
}
