// 드라이버로 역할을 호출하는 작업 실행 루프 (브라우저 경로의 SubprocessDriver, 데모의 FixtureDriver).
// 엔진의 next → (역할 호출·검증·재시도) → submit을 반복하고, 역할이 모두 끝나면 finalize한다.
// 애널리스트처럼 next가 여러 단계를 주면 병렬로 호출한다. 하나가 실패하면 나머지를 취소하고 첫 실패로 작업을 끝낸다.
import type { ModelDriver } from '../model/driver.ts';
import type { ErrorCode } from '../model/errors.ts';
import type { Role } from '../schema/types.ts';
import { budgetFor, JobBudget } from './budget.ts';
import type { Engine, FinalizeOptions, Job } from './engine.ts';
import { callRole, type RoleCallOptions } from './retry.ts';

export interface RunOptions extends FinalizeOptions {
  sleep?: RoleCallOptions<unknown>['sleep'];
}

export async function runJob(engine: Engine, job: Job, driver: ModelDriver, signal: AbortSignal, opts: RunOptions = {}): Promise<Job> {
  const r = job.record;
  // 작업 시간 상한은 작업 생성(데이터 수집 포함)부터 잰다
  const budget = new JobBudget(budgetFor(r.mode), () => engine.now().getTime(), Date.parse(r.createdAt));
  budget.modelCallCount = r.usage.modelCallCount;
  budget.retryCallCount = r.usage.retryCallCount;
  budget.calls.push(...r.usage.calls);
  if (opts.claudeCliVersion) r.claudeCliVersion ??= opts.claudeCliVersion; // 다음 저장에 함께 기록된다 (P1-11-R3)

  for (;;) {
    const n = engine.next(job);
    if (n.kind === 'done') return job;
    if (n.kind === 'finalize') {
      engine.finalize(job, opts);
      return job;
    }

    const local = new AbortController();
    const onAbort = () => local.abort();
    if (signal.aborted) local.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
    let failure: { code: ErrorCode; detail: string; role: Role } | null = null;
    const stop = (f: NonNullable<typeof failure>) => {
      if (failure) return;
      failure = f;
      local.abort();
    };

    await Promise.all(n.steps.map(async (step) => {
      const res = await callRole(driver, { ...step.request, input: step.inputText, timeoutMs: 0, maxOutputChars: 0 }, budget, {
        signal: local.signal,
        validate: (o) => engine.validate(job, step.stepId, o),
        ...(opts.sleep ? { sleep: opts.sleep } : {}),
      });
      engine.syncUsage(job, budget);
      if (!res.ok) return stop({ code: res.code, detail: res.detail, role: step.role });
      const s = engine.submit(job, step.stepId, res.value);
      if (!s.ok) stop({ code: 'E-SCHEMA', detail: s.kind === 'schema' ? s.summary : s.message, role: step.role });
    }));
    signal.removeEventListener('abort', onAbort);
    engine.syncUsage(job, budget);
    const f = failure as { code: ErrorCode; detail: string; role: Role } | null;
    if (f) {
      engine.fail(job, f.code, f.detail, f.role);
      return job;
    }
  }
}
