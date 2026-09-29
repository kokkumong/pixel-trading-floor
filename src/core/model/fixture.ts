// 데모용 드라이버: 미리 준비한 역할 응답을 재생한다. 모델 호출로 세지 않는다 (P0-1-R4).
// 데모 응답도 실전과 같은 스키마 검증·규칙 엔진을 거친다 (P1-8-R3) — 검증은 작업 엔진이 한다.
import type { ModelDriver, ModelResult } from './driver.ts';
import type { Role } from '../schema/types.ts';

export function createFixtureDriver(responses: Partial<Record<Role, unknown[]>>, delayMs = 0): ModelDriver {
  const used: Partial<Record<Role, number>> = {};
  return {
    kind: 'fixture',
    countsAsModelCall: false,
    async call(req, signal): Promise<ModelResult> {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      if (signal.aborted) return { ok: false, code: 'E-CANCELLED', detail: '데모 취소', durationMs: 0 };
      const list = responses[req.role] ?? [];
      const i = used[req.role] ?? 0;
      used[req.role] = i + 1;
      const output = list[Math.min(i, list.length - 1)];
      if (output === undefined) return { ok: false, code: 'E-SCHEMA', detail: `데모 응답 없음: ${req.role}`, durationMs: 0 };
      return { ok: true, output, outputChars: JSON.stringify(output).length, modelId: 'demo-fixture', usage: { inputTokens: null, outputTokens: null, costUsd: null }, durationMs: delayMs };
    },
  };
}
