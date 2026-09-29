// 거래소 달력과 시간대 (P1 명세 3.3). 모든 시각은 UTC Date로 다루고, 표시할 때만 거래소 시간대로 바꾼다 (P1-3-R8).
// 포함 기간 밖의 날짜는 장 상태를 추측하지 않는다 (P1-3-R7).
import calendarData from './calendars.json' with { type: 'json' };
import type { CalendarId } from './registry.ts';

interface SessionTimes {
  open: string;
  close: string;
  reason?: string;
}
interface ExchangeCalendar {
  timezone: string;
  open: string;
  close: string;
  coverage: { from: string; to: string };
  holidays: Record<string, string>;
  specialSessions: Record<string, SessionTimes>;
}
interface CalendarFile {
  calendarVersion: string;
  calendars: Record<'KRX' | 'US', ExchangeCalendar>;
}

const DATA = calendarData as CalendarFile;
export const CALENDAR_VERSION = DATA.calendarVersion;

export interface LocalParts {
  date: string; // YYYY-MM-DD
  hour: number;
  minute: number;
  weekday: number; // 0=일 … 6=토
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
export function localParts(at: Date, timeZone: string): LocalParts {
  let fmt = fmtCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
    });
    fmtCache.set(timeZone, fmt);
  }
  const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday!),
  };
}

/** 거래소 시간대의 "YYYY-MM-DD HH:MM"에 해당하는 UTC 시각 (서머타임 반영) */
export function zonedTime(date: string, hhmm: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(':').map(Number) as [number, number];
  const target = Date.UTC(y, m - 1, d, h, mi);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const lp = localParts(new Date(guess), timeZone);
    const [ly, lm, ld] = lp.date.split('-').map(Number) as [number, number, number];
    const diff = Date.UTC(ly, lm - 1, ld, lp.hour, lp.minute) - target;
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export interface Session {
  date: string;
  open: Date;
  close: Date;
  special?: string;
}

/** 해당 날짜(거래소 현지)의 거래 여부. null이면 포함 기간 밖이라 알 수 없음. */
export function isTradingDay(cal: CalendarId, date: string): boolean | null {
  if (cal === 'CRYPTO_24_7') return true;
  const c = DATA.calendars[cal];
  if (date < c.coverage.from || date > c.coverage.to) return null;
  const wd = weekdayOf(date);
  return wd !== 0 && wd !== 6 && !(date in c.holidays);
}

export function sessionOn(cal: 'KRX' | 'US', date: string): Session | null {
  if (!isTradingDay(cal, date)) return null;
  const c = DATA.calendars[cal];
  const sp = c.specialSessions[date];
  const times = sp ?? c;
  return {
    date,
    open: zonedTime(date, times.open, c.timezone),
    close: zonedTime(date, times.close, c.timezone),
    ...(sp?.reason ? { special: sp.reason } : {}),
  };
}

export type MarketState = 'OPEN' | 'CLOSED' | 'UNKNOWN';

export interface MarketStatus {
  state: MarketState;
  label: string; // 화면 배지
  timezone: string;
  session: Session | null;
  holiday?: string;
}

/** MARKET OPEN 배지 판정 (P1-3-R6, R7) */
export function marketStatus(cal: CalendarId, at: Date): MarketStatus {
  if (cal === 'CRYPTO_24_7') return { state: 'OPEN', label: '24시간 거래', timezone: 'UTC', session: null };
  const c = DATA.calendars[cal];
  const today = localParts(at, c.timezone).date;
  const trading = isTradingDay(cal, today);
  if (trading === null) return { state: 'UNKNOWN', label: '장 상태 확인 불가', timezone: c.timezone, session: null };
  if (!trading) {
    const holiday = c.holidays[today];
    return { state: 'CLOSED', label: holiday ? `휴장 · ${holiday}` : '휴장 · 주말', timezone: c.timezone, session: null, ...(holiday ? { holiday } : {}) };
  }
  const s = sessionOn(cal, today)!;
  const open = at >= s.open && at < s.close;
  return { state: open ? 'OPEN' : 'CLOSED', label: open ? 'MARKET OPEN' : '장 마감', timezone: c.timezone, session: s };
}

/**
 * at 이전에 끝난 가장 최근 정규 세션. 포함 기간 밖의 날은 평일을 거래일로 가정한다
 * (더 보수적인 쪽: 데이터가 오래된 것으로 판정되기 쉬움). assumed가 true면 가정이 들어갔다는 뜻.
 */
export function latestCompletedSession(cal: 'KRX' | 'US', at: Date): { date: string; close: Date; assumed: boolean } {
  const c = DATA.calendars[cal];
  let date = localParts(at, c.timezone).date;
  let assumed = false;
  for (let i = 0; i < 20; i++, date = addDays(date, -1)) {
    const t = isTradingDay(cal, date);
    const wd = weekdayOf(date);
    const trading = t ?? (wd !== 0 && wd !== 6);
    if (t === null) assumed = true;
    if (!trading) continue;
    const sp = c.specialSessions[date];
    const close = zonedTime(date, (sp ?? c).close, c.timezone);
    if (close <= at) return { date, close, assumed };
  }
  throw new Error('최근 20일 안에 거래일이 없음');
}

/** 포함 기간이 days일 안에 끝나는 달력 (진단 경고용, P1 명세 v0.2 8.2) */
export function calendarCoverageWarnings(now: Date, days = 30): string[] {
  const out: string[] = [];
  for (const [id, c] of Object.entries(DATA.calendars)) {
    const end = Date.parse(c.coverage.to + 'T23:59:59Z');
    const left = Math.floor((end - now.getTime()) / 86_400_000);
    if (left < 0) out.push(`${id} 달력 포함 기간(${c.coverage.to})이 지났습니다. 휴장일 데이터를 추가하세요`);
    else if (left <= days) out.push(`${id} 달력 포함 기간이 ${left}일 뒤(${c.coverage.to}) 끝납니다. 다음 해 휴장일 공고를 반영하세요`);
  }
  return out;
}

export function calendarTimezone(cal: CalendarId): string {
  return cal === 'CRYPTO_24_7' ? 'UTC' : DATA.calendars[cal].timezone;
}
