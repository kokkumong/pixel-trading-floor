// 추정 시세 산출 (P1 명세 2.5). 표시·비교 전용이며 판정 기준으로 쓰지 않는다 (P0-4-R3).
import type { EstimatePayload } from './sources.ts';

export const ESTIMATE_RULES = { minSources: 3, outlierRatio: 0.005, maxSpreadRatio: 0.01 } as const; // 초기값

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * 3개 이상 거래소 가격의 중앙값. 중앙값에서 0.5% 넘게 벗어난 가격은 빼고, 남은 가격이 3개 미만이거나
 * 남은 가격 간 최대 편차가 1%를 넘으면 산출 불가. 추정값은 남은 가격의 중앙값.
 */
export function estimatePrice(prices: { exchange: string; price: number }[]): EstimatePayload {
  const valid = prices.filter((p) => Number.isFinite(p.price) && p.price > 0);
  const base: EstimatePayload = { value: null, method: 'median', used: [], excluded: [] };
  if (valid.length < ESTIMATE_RULES.minSources) return { ...base, used: valid, reason: `거래소 가격 ${valid.length}개 (최소 ${ESTIMATE_RULES.minSources}개)` };
  const mid = median(valid.map((p) => p.price));
  const used = valid.filter((p) => Math.abs(p.price - mid) / mid <= ESTIMATE_RULES.outlierRatio);
  const excluded = valid
    .filter((p) => !used.includes(p))
    .map((p) => ({ ...p, deviation: (p.price - mid) / mid }));
  if (used.length < ESTIMATE_RULES.minSources) return { ...base, used, excluded, reason: '이상치 제외 후 거래소 가격 부족' };
  const hi = Math.max(...used.map((p) => p.price));
  const lo = Math.min(...used.map((p) => p.price));
  if ((hi - lo) / lo > ESTIMATE_RULES.maxSpreadRatio) return { ...base, used, excluded, reason: '거래소 간 편차 1% 초과' };
  return { value: median(used.map((p) => p.price)), method: 'median', used, excluded };
}
