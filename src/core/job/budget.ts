// 작업 예산 (P0 명세 8장). 다음 호출을 시작하기 전에 호출 수·경과 시간·재시도 예산을 검사한다 (P0-8-R1).
import configJson from '../../../config/floor.config.json' with { type: 'json' };
import type { Mode, Role } from '../schema/types.ts';

export interface BudgetConfig {
  maxModelCalls: number;
  maxRetriesPerCall: number;
  maxRetriesPerJob: number;
  maxInputChars: number;
  maxOutputChars: number;
  maxOutputCharsByRole: Partial<Record<Role, number>>;
  callTimeoutSeconds: number;
  maxDurationSeconds: number;
}

export function budgetFor(mode: Mode): BudgetConfig {
  return (configJson.budgets as Record<Mode, BudgetConfig>)[mode];
}

export const MAX_CONCURRENT_JOBS: number = configJson.maxConcurrentJobs;

export type Effort = 'low' | 'medium' | 'high';

/** 역할별 모델과 사고 수준 (보완안 10.3 모델 라우팅). 실제 사용 모델은 CLI 보고값으로 따로 기록한다 */
export function modelFor(role: Role): { model: string; effort: Effort } {
  const m = configJson.models as { default: string; roles: Partial<Record<Role, string>>; effort: { default: Effort; roles: Partial<Record<Role, Effort>> } };
  return { model: m.roles[role] ?? m.default, effort: m.effort.roles[role] ?? m.effort.default };
}

/** 호출별 기록 (P0-8-R7): 리포트와 P1-11 실측의 원자료 */
export interface CallRecord {
  role: Role;
  startedAt: string;
  durationSeconds: number;
  inputChars: number;
  outputChars: number;
  retried: boolean;
  outcome: 'ok' | string; // 성공 또는 오류 코드
  modelId: string | null;
  usageReported: { inputTokens: number | null; outputTokens: number | null; costUsd: number | null } | null;
}

export type BudgetCheck = { ok: true } | { ok: false; reason: 'calls' | 'duration' | 'retries'; detail: string };

export class JobBudget {
  readonly cfg: BudgetConfig;
  readonly startedAt: number;
  private readonly now: () => number;
  modelCallCount = 0;
  retryCallCount = 0;
  readonly calls: CallRecord[] = [];

  constructor(cfg: BudgetConfig, now: () => number = Date.now, startedAt: number = now()) {
    this.cfg = cfg;
    this.now = now;
    this.startedAt = startedAt;
  }

  elapsedMs(): number {
    return this.now() - this.startedAt;
  }

  remainingMs(): number {
    return this.cfg.maxDurationSeconds * 1000 - this.elapsedMs();
  }

  /** 다음 호출을 시작해도 되는지 (P0-8-R1) */
  canStart(isRetry: boolean): BudgetCheck {
    if (this.modelCallCount >= this.cfg.maxModelCalls) return { ok: false, reason: 'calls', detail: `호출 상한 ${this.cfg.maxModelCalls}회 도달` };
    if (this.remainingMs() <= 0) return { ok: false, reason: 'duration', detail: `작업 시간 상한 ${this.cfg.maxDurationSeconds}초 도달` };
    if (isRetry && this.retryCallCount >= this.cfg.maxRetriesPerJob) return { ok: false, reason: 'retries', detail: `작업 재시도 상한 ${this.cfg.maxRetriesPerJob}회 도달` };
    return { ok: true };
  }

  maxOutputChars(role: Role): number {
    return this.cfg.maxOutputCharsByRole[role] ?? this.cfg.maxOutputChars;
  }
}
