// 테스트용 드라이버: 역할별로 정해 둔 결과(정상 출력, 오류, 지연, 무응답)를 순서대로 돌려준다.
import type { ErrorCode } from './errors.ts';
import type { ModelDriver, ModelRequest, ModelResult } from './driver.ts';
import type { Role } from '../schema/types.ts';

export type Step =
  | { output: unknown; delayMs?: number }
  | { error: ErrorCode; detail?: string; delayMs?: number }
  | { hang: true }; // 취소·시간 초과될 때까지 응답하지 않음

export interface ScriptedDriver extends ModelDriver {
  calls: ModelRequest[];
}

export function createScriptedDriver(script: Partial<Record<Role, Step[]>>, fallback?: (req: ModelRequest) => Step): ScriptedDriver {
  const used: Partial<Record<Role, number>> = {};
  const calls: ModelRequest[] = [];
  return {
    kind: 'scripted',
    countsAsModelCall: true,
    calls,
    async call(req, signal): Promise<ModelResult> {
      calls.push(req);
      const list = script[req.role] ?? [];
      const i = used[req.role] ?? 0;
      used[req.role] = i + 1;
      const step = list[i] ?? list.at(-1) ?? fallback?.(req);
      if (!step) throw new Error(`스크립트에 없는 호출: ${req.role}`);
      const started = Date.now();
      const wait = (ms: number) => new Promise<boolean>((res) => {
        const t = setTimeout(() => res(true), ms);
        signal.addEventListener('abort', () => { clearTimeout(t); res(false); }, { once: true });
      });
      if ('hang' in step) {
        const done = await wait(req.timeoutMs);
        return done
          ? { ok: false, code: 'E-TIMEOUT', detail: `${req.role} 시간 초과`, durationMs: Date.now() - started }
          : { ok: false, code: 'E-CANCELLED', detail: '취소', durationMs: Date.now() - started };
      }
      if (step.delayMs && !(await wait(step.delayMs))) return { ok: false, code: 'E-CANCELLED', detail: '취소', durationMs: Date.now() - started };
      if ('error' in step) return { ok: false, code: step.error, detail: step.detail ?? step.error, durationMs: Date.now() - started };
      const text = JSON.stringify(step.output);
      return { ok: true, output: step.output, outputChars: text.length, modelId: 'scripted', usage: { inputTokens: null, outputTokens: null, costUsd: null }, durationMs: Date.now() - started };
    },
  };
}
