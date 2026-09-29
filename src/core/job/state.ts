// 작업 상태 머신 (P1 명세 1.1~1.3). 종료 상태는 다시 바뀌지 않는다 (P1-1-R3).
import type { Mode } from '../schema/types.ts';

export const PROGRESS_STATES = [
  'QUEUED', 'COLLECTING_DATA', 'VALIDATING_DATA', 'ANALYZING', 'DEBATING', 'PLANNING', 'RISK_REVIEW', 'PROPOSING',
  'FINAL_REVIEW', 'VALIDATING_DECISION', 'SAVING',
] as const;
export const TERMINAL_STATES = [
  'COMPLETED', 'INSUFFICIENT_DATA', 'UNSUPPORTED_SYMBOL', 'SCHEMA_ERROR', 'BUDGET_EXCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED',
] as const;
export type ProgressState = (typeof PROGRESS_STATES)[number];
export type TerminalState = (typeof TERMINAL_STATES)[number];
export type JobState = ProgressState | TerminalState;

/** 모드별 정상 경로 (P1 명세 1.2) */
const COMMON = ['QUEUED', 'COLLECTING_DATA', 'VALIDATING_DATA'] as const;
const TAIL = ['VALIDATING_DECISION', 'SAVING', 'COMPLETED'] as const;
const SCALP_PATH: readonly JobState[] = [...COMMON, 'ANALYZING', 'PLANNING', 'RISK_REVIEW', 'PROPOSING', ...TAIL];
export const MODE_PATHS: Record<Mode, readonly JobState[]> = {
  algorithm: [...COMMON, 'ANALYZING', 'DEBATING', 'PROPOSING', 'RISK_REVIEW', 'FINAL_REVIEW', ...TAIL],
  scalp: SCALP_PATH,
  forced_direction: SCALP_PATH,
};

/** 재시도 없이 정상 완료될 때의 호출 수 범위 (P0-1-R3) */
export const PLANNED_CALLS: Record<Mode, { min: number; max: number }> = {
  algorithm: { min: 11, max: 13 },
  scalp: { min: 5, max: 5 },
  forced_direction: { min: 5, max: 5 },
};

/** 역할 호출이 일어나는 단계 (스키마 오류로 끝날 수 있는 곳) */
const MODEL_STATES: readonly JobState[] = ['ANALYZING', 'DEBATING', 'PLANNING', 'RISK_REVIEW', 'PROPOSING', 'FINAL_REVIEW', 'VALIDATING_DECISION'];
const ANYWHERE: readonly JobState[] = ['CANCELLED', 'BUDGET_EXCEEDED', 'FAILED', 'INTERRUPTED'];

export function isTerminal(s: JobState): s is TerminalState {
  return (TERMINAL_STATES as readonly string[]).includes(s);
}

export function canTransition(mode: Mode, from: JobState, to: JobState): boolean {
  if (isTerminal(from)) return false;
  if (ANYWHERE.includes(to)) return true;
  if (to === 'INSUFFICIENT_DATA') return from === 'VALIDATING_DATA';
  if (to === 'UNSUPPORTED_SYMBOL') return from === 'QUEUED';
  if (to === 'SCHEMA_ERROR') return MODEL_STATES.includes(from);
  const path = MODE_PATHS[mode];
  const i = path.indexOf(from);
  return i >= 0 && path[i + 1] === to;
}

export class JobStateError extends Error {}

export interface StateHolder {
  mode: Mode;
  state: JobState;
  history: { state: JobState; at: string }[];
}

/** 상태를 바꾸고 이력에 남긴다. 허용되지 않은 전이(종료 상태에서의 변경 포함)는 JobStateError */
export function transition(rec: StateHolder, to: JobState, at: Date): void {
  if (!canTransition(rec.mode, rec.state, to)) throw new JobStateError(`${rec.mode}: ${rec.state} → ${to} 전이 불가`);
  rec.state = to;
  rec.history.push({ state: to, at: at.toISOString() });
}
