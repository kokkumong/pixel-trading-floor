// PC 시계 오차 (P1 명세 8.2, E13). 공급자 응답의 Date 헤더와 이 PC의 시계를 비교한다.
// TTL 판정(P0-4.4)이 PC 시계에 의존하므로 오차가 크면 실전 분석을 막는다.
import type { NetClient } from './net.ts';

export const CLOCK_LIMITS = { okMs: 5_000, warnMs: 30_000, blockMs: 60_000 } as const;

export interface ClockProbe {
  net: NetClient;
  /** 이 PC 시계 − 공급자 시계 (ms, 양수면 PC가 빠름). 이번 수집에서 Date 헤더를 하나도 못 받았으면 null */
  skewMs(): number | null;
}

/** 요청을 그대로 넘기면서 응답의 Date 헤더로 시계 오차를 잰다. 헤더는 초 단위라 오차 범위 안에서 가장 작은 값을 쓴다 */
export function createClockProbe(net: NetClient, now: () => number = Date.now): ClockProbe {
  const samples: number[] = [];
  return {
    net: {
      kind: net.kind,
      async get(url, expect) {
        const res = await net.get(url, expect);
        const server = res.date ? Date.parse(res.date) : NaN;
        if (Number.isFinite(server)) samples.push(now() - server);
        return res;
      },
    },
    skewMs() {
      if (samples.length === 0) return null;
      // Date 헤더는 초를 버리므로 0~1초 늦게 보인다. 절댓값이 가장 작은 표본이 실제 오차에 가장 가깝다
      return samples.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
    },
  };
}

export type ClockVerdict = { level: 'ok' | 'warn' | 'error'; message: string };

export function judgeClock(skewMs: number): ClockVerdict {
  const s = Math.round(Math.abs(skewMs) / 1000);
  const dir = skewMs > 0 ? '빠름' : '느림';
  if (Math.abs(skewMs) > CLOCK_LIMITS.blockMs) return { level: 'error', message: `PC 시계가 ${s}초 ${dir} (60초 초과: 실전 분석 차단)` };
  if (Math.abs(skewMs) > CLOCK_LIMITS.warnMs) return { level: 'warn', message: `PC 시계가 ${s}초 ${dir} (30초 초과)` };
  return { level: 'ok', message: Math.abs(skewMs) <= CLOCK_LIMITS.okMs ? `오차 ${s}초 이내` : `PC 시계가 ${s}초 ${dir}` };
}
