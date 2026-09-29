// 소스별 TTL과 신선도 등급 (P0 명세 4.4, P0-4-R2). 시각은 모두 공급자 관측 시각(observedAt) 기준이며,
// 공급자가 시각을 주지 않으면 fetchedAt으로 대체하지 않고 UNKNOWN_TIME으로 둔다.
import type { Mode } from '../schema/types.ts';
import { latestCompletedSession, marketStatus } from './calendar.ts';
import type { Instrument } from './registry.ts';
import type { EndpointType } from './sources.ts';

export type Freshness = 'LIVE' | 'NEAR_REALTIME' | 'DELAYED' | 'PERIODIC' | 'ESTIMATED' | 'UNKNOWN_TIME';

export interface FreshnessResult {
  freshness: Freshness;
  ttlSeconds: number;
  ageSeconds: number | null;
  stale: boolean;
  note?: string;
}

const MIN = 60;
/** 주식 장중 가격 TTL: 공급자 지연 20분(Yahoo KRX·미국 무료 시세) + 폴링 여유 5분 (P0 명세 v0.6 4.4) */
export const STOCK_INTRADAY_TTL = 25 * MIN;
const HOUR = 3600;
const DAY = 86_400;

export interface FreshnessInput {
  id: string;
  endpointType: EndpointType;
  observedAt: string | null;
  estimated: boolean;
  /** 캔들: 봉 길이(초) */
  intervalSeconds?: number;
}

export function evaluateFreshness(src: FreshnessInput, inst: Instrument, mode: Mode, now: Date): FreshnessResult {
  const scalpLike = mode !== 'algorithm';
  const observed = src.observedAt ? Date.parse(src.observedAt) : NaN;
  const age = Number.isFinite(observed) ? Math.max(0, Math.round((now.getTime() - observed) / 1000)) : null;
  const res = (freshness: Freshness, ttlSeconds: number, stale: boolean, note?: string): FreshnessResult => ({
    freshness: src.estimated ? 'ESTIMATED' : age === null ? 'UNKNOWN_TIME' : freshness,
    ttlSeconds,
    ageSeconds: age,
    stale: age === null ? false : stale,
    ...(note ? { note } : {}),
  });

  switch (src.endpointType) {
    case 'price': {
      if (inst.assetClass === 'crypto' || src.id.includes('.perp.')) {
        const ttl = scalpLike ? 30 : 120;
        return res('NEAR_REALTIME', ttl, age !== null && age > ttl);
      }
      // 주식 현물 가격: 장중 STOCK_INTRADAY_TTL, 장 마감 뒤에는 다음 개장 전까지
      const st = marketStatus(inst.calendarId, now);
      if (st.state === 'OPEN' || st.state === 'UNKNOWN' || inst.calendarId === 'CRYPTO_24_7') {
        return res('DELAYED', STOCK_INTRADAY_TTL, age !== null && age > STOCK_INTRADAY_TTL, st.state === 'UNKNOWN' ? '장 상태 확인 불가: 장중 기준 적용' : undefined);
      }
      const last = latestCompletedSession(inst.calendarId, now);
      const fresh = observed >= last.close.getTime() - 30 * MIN;
      return res('PERIODIC', Math.round((now.getTime() - last.close.getTime()) / 1000) + 30 * MIN, !fresh);
    }
    case 'candle': {
      const interval = src.intervalSeconds ?? DAY;
      if (interval < DAY) {
        // 15분봉: 마지막 완성 봉 종료 후 한 봉 길이 + 90초 안에 다음 봉이 와 있어야 한다
        const ttl = interval + 90;
        return res('NEAR_REALTIME', ttl, age !== null && age > ttl);
      }
      // 일봉: 가장 최근에 끝난 거래일의 봉이 없으면, 그 거래일 종료 후 36시간까지만 허용
      const lastEnd = inst.calendarId === 'CRYPTO_24_7'
        ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
        : latestCompletedSession(inst.calendarId, now).close.getTime();
      const missingLatest = observed < lastEnd - 12 * HOUR; // 마지막 봉이 최근 거래일 것이 아님
      const stale = missingLatest && now.getTime() - lastEnd > 36 * HOUR;
      return res('PERIODIC', 36 * HOUR, stale);
    }
    case 'funding':
      return res('NEAR_REALTIME', 15 * MIN, age !== null && age > 15 * MIN);
    case 'fx': {
      // 외환시장 주말(금 22시 ~ 일 22시 UTC)에는 금요일 20시 UTC 이후 관측 시세를 유효로 본다 (P0 명세 v0.6 4.4)
      if (inFxWeekend(now) && observed >= fxWeekendStart(now) - 2 * HOUR) {
        return res('PERIODIC', HOUR, false, '외환시장 주말: 금요일 마감 시세');
      }
      return res('NEAR_REALTIME', HOUR, age !== null && age > HOUR);
    }
    case 'news':
      return res('PERIODIC', 72 * HOUR, age !== null && age > 72 * HOUR);
    case 'sentiment':
      return res('PERIODIC', 36 * HOUR, age !== null && age > 36 * HOUR);
    case 'fundamentals':
      return res('PERIODIC', 7 * DAY, age !== null && age > 7 * DAY);
  }
}

function inFxWeekend(now: Date): boolean {
  const d = now.getUTCDay();
  const h = now.getUTCHours();
  return (d === 5 && h >= 22) || d === 6 || (d === 0 && h < 22);
}

function fxWeekendStart(now: Date): number {
  const d = now.getUTCDay();
  const back = d === 5 ? 0 : d === 6 ? 1 : 2;
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back, 22);
}
