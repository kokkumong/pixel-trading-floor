import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransition, isTerminal, JobStateError, MODE_PATHS, PLANNED_CALLS, transition, TERMINAL_STATES, type JobState,
} from '../../../src/core/job/state.ts';
import { MODES } from '../../../src/core/schema/types.ts';

test('P1-1 모드별 정상 경로는 명세 1.2와 같다', () => {
  const common = ['QUEUED', 'COLLECTING_DATA', 'VALIDATING_DATA'];
  assert.deepEqual(MODE_PATHS.algorithm, [...common, 'ANALYZING', 'DEBATING', 'PROPOSING', 'RISK_REVIEW', 'FINAL_REVIEW', 'VALIDATING_DECISION', 'SAVING', 'COMPLETED']);
  assert.deepEqual(MODE_PATHS.scalp, [...common, 'ANALYZING', 'PLANNING', 'RISK_REVIEW', 'PROPOSING', 'VALIDATING_DECISION', 'SAVING', 'COMPLETED']);
  assert.deepEqual(MODE_PATHS.forced_direction, MODE_PATHS.scalp);
});

test('P0-1-R3 계획 호출 수: algorithm 11~13, scalp·forced 5', () => {
  assert.deepEqual(PLANNED_CALLS.algorithm, { min: 11, max: 13 });
  assert.deepEqual(PLANNED_CALLS.scalp, { min: 5, max: 5 });
  assert.deepEqual(PLANNED_CALLS.forced_direction, { min: 5, max: 5 });
});

test('정상 경로는 바로 다음 단계로만 간다 (건너뛰기·되돌리기 금지)', () => {
  assert.ok(canTransition('algorithm', 'ANALYZING', 'DEBATING'));
  assert.equal(canTransition('algorithm', 'ANALYZING', 'PROPOSING'), false);
  assert.equal(canTransition('algorithm', 'DEBATING', 'ANALYZING'), false);
  assert.equal(canTransition('scalp', 'ANALYZING', 'DEBATING'), false); // scalp에는 토론이 없다
  assert.ok(canTransition('scalp', 'RISK_REVIEW', 'PROPOSING'));
});

test('진행 상태에서는 어디서든 취소·예산 초과·실패·중단으로 갈 수 있다', () => {
  for (const mode of MODES) {
    for (const s of MODE_PATHS[mode].filter((x) => !isTerminal(x))) {
      for (const t of ['CANCELLED', 'BUDGET_EXCEEDED', 'FAILED', 'INTERRUPTED'] as JobState[]) assert.ok(canTransition(mode, s, t), `${mode} ${s}→${t}`);
    }
  }
});

test('INSUFFICIENT_DATA는 VALIDATING_DATA에서만, UNSUPPORTED_SYMBOL은 QUEUED에서만', () => {
  assert.ok(canTransition('scalp', 'VALIDATING_DATA', 'INSUFFICIENT_DATA'));
  assert.equal(canTransition('scalp', 'ANALYZING', 'INSUFFICIENT_DATA'), false);
  assert.ok(canTransition('scalp', 'QUEUED', 'UNSUPPORTED_SYMBOL'));
  assert.equal(canTransition('scalp', 'COLLECTING_DATA', 'UNSUPPORTED_SYMBOL'), false);
  // 스키마 오류는 역할 호출 단계와 판정 검증 단계에서만
  assert.ok(canTransition('algorithm', 'DEBATING', 'SCHEMA_ERROR'));
  assert.ok(canTransition('algorithm', 'VALIDATING_DECISION', 'SCHEMA_ERROR'));
  assert.equal(canTransition('algorithm', 'COLLECTING_DATA', 'SCHEMA_ERROR'), false);
});

test('P1-1-T4 종료된 작업의 상태를 바꾸려는 호출은 거부된다', () => {
  for (const t of TERMINAL_STATES) {
    const rec = { mode: 'scalp' as const, state: t as JobState, history: [{ state: t as JobState, at: '2026-09-29T00:00:00.000Z' }] };
    assert.throws(() => transition(rec, 'FAILED', new Date()), JobStateError, t);
    assert.throws(() => transition(rec, 'QUEUED', new Date()), JobStateError, t);
    assert.equal(rec.state, t);
    assert.equal(rec.history.length, 1);
  }
});

test('transition은 상태와 이력을 함께 갱신하고, 허용되지 않은 전이는 거부한다', () => {
  const rec = { mode: 'scalp' as const, state: 'QUEUED' as JobState, history: [{ state: 'QUEUED' as JobState, at: 'x' }] };
  transition(rec, 'COLLECTING_DATA', new Date('2026-09-29T01:00:00Z'));
  assert.equal(rec.state, 'COLLECTING_DATA');
  assert.deepEqual(rec.history.at(-1), { state: 'COLLECTING_DATA', at: '2026-09-29T01:00:00.000Z' });
  assert.throws(() => transition(rec, 'PROPOSING', new Date()), JobStateError);
});
