// 역할 호출 한 번과 재시도 (P0 명세 8.4). 재시도·시간 초과·취소로 끝난 호출도 시작했다면 호출 수에 넣는다 (P0-1-R4).
import type { ModelDriver, ModelRequest } from '../model/driver.ts';
import { isRetryable, type ErrorCode } from '../model/errors.ts';
import type { JobBudget } from './budget.ts';

export type Validation<T> = { ok: true; value: T } | { ok: false; summary: string };

export type RoleCallResult<T> =
  | { ok: true; value: T; attempts: number }
  | { ok: false; code: ErrorCode; detail: string; attempts: number };

export const BACKOFF_MS = [2000, 4000] as const;

export interface RoleCallOptions<T> {
  validate: (output: unknown) => Validation<T>;
  signal: AbortSignal;
  sleep?: (ms: number, signal: AbortSignal) => Promise<boolean>;
}

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<boolean>((res) => {
    if (signal.aborted) return res(false);
    const t = setTimeout(() => res(true), ms);
    signal.addEventListener('abort', () => { clearTimeout(t); res(false); }, { once: true });
  });

/**
 * 역할을 호출하고 출력을 검증한다. 재시도 대상 오류(시간 초과, 스키마 오류, 비정상 종료)면 호출당 최대
 * maxRetriesPerCall번까지 2초·4초 간격으로 다시 호출한다. 스키마 오류 재시도에는 오류 요약을 덧붙인다.
 * 호출을 시작하기 전마다 예산을 검사하고, 넘으면 호출하지 않고 E-BUDGET으로 끝낸다.
 */
export async function callRole<T>(driver: ModelDriver, req: ModelRequest, budget: JobBudget, opts: RoleCallOptions<T>): Promise<RoleCallResult<T>> {
  const sleep = opts.sleep ?? defaultSleep;
  let input = req.input;
  let attempts = 0;
  let last: { code: ErrorCode; detail: string } = { code: 'E-CLI-CRASH', detail: '' };

  for (let retry = 0; retry <= budget.cfg.maxRetriesPerCall; retry++) {
    const isRetry = retry > 0;
    if (opts.signal.aborted) return { ok: false, code: 'E-CANCELLED', detail: '취소됨', attempts };
    const check = budget.canStart(isRetry);
    if (!check.ok) {
      // 재시도 예산만 떨어졌으면 마지막 오류로 끝내고, 호출 수·시간 상한이면 BUDGET_EXCEEDED
      return check.reason === 'retries' ? { ok: false, ...last, attempts } : { ok: false, code: 'E-BUDGET', detail: check.detail, attempts };
    }

    // 작업 시간 상한이 호출 시간 제한보다 먼저 오면 남은 시간까지만 기다린다
    const callTimeout = budget.cfg.callTimeoutSeconds * 1000;
    const timeoutMs = Math.min(callTimeout, budget.remainingMs());
    const startedAt = new Date().toISOString();
    attempts++;
    if (driver.countsAsModelCall) {
      budget.modelCallCount++;
      if (isRetry) budget.retryCallCount++;
    }
    const r = await driver.call({ ...req, input, timeoutMs, maxOutputChars: budget.maxOutputChars(req.role) }, opts.signal);

    let outcome: string;
    if (r.ok) {
      const v = opts.validate(r.output);
      budget.calls.push({
        role: req.role, startedAt, durationSeconds: r.durationMs / 1000, inputChars: req.systemPrompt.length + input.length,
        outputChars: r.outputChars, retried: isRetry, outcome: v.ok ? 'ok' : 'E-SCHEMA', modelId: r.modelId, usageReported: r.usage,
      });
      if (v.ok) return { ok: true, value: v.value, attempts };
      last = { code: 'E-SCHEMA', detail: `${req.role}: ${v.summary}` };
      input = `${req.input}\n\n[이전 응답 오류] 다음 문제를 고쳐 스키마에 맞는 JSON만 다시 답하라: ${v.summary.slice(0, 800)}`;
      outcome = 'E-SCHEMA';
    } else {
      const code: ErrorCode = r.code === 'E-TIMEOUT' && timeoutMs < callTimeout ? 'E-BUDGET' : r.code;
      budget.calls.push({
        role: req.role, startedAt, durationSeconds: r.durationMs / 1000, inputChars: req.systemPrompt.length + input.length,
        outputChars: 0, retried: isRetry, outcome: code, modelId: null, usageReported: null,
      });
      last = { code, detail: r.detail };
      outcome = code;
      if (!isRetryable(code)) return { ok: false, ...last, attempts };
    }
    if (retry < budget.cfg.maxRetriesPerCall) {
      const waited = await sleep(BACKOFF_MS[Math.min(retry, BACKOFF_MS.length - 1)]!, opts.signal);
      if (!waited) return { ok: false, code: 'E-CANCELLED', detail: `${outcome} 뒤 재시도 대기 중 취소`, attempts };
    }
  }
  return { ok: false, ...last, attempts };
}
