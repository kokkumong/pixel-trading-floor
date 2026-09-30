// 단계 계산과 역할 출력 검증 (순수 함수). 다음 단계는 커서가 아니라 지금까지의 출력에서 계산한다.
// 브라우저 경로(callRole의 validate)와 /floor 경로(submit)가 같은 검증 함수를 쓴다 (P1-5-R2).
import {
  checkBriefing, checkDebate, checkPm, type BriefingRole, type DebateMessage,
} from '../schema/agents.ts';
import type { SchemaError } from '../schema/dsl.ts';
import { checkProposal, diffProposalFields, type ProposalAuthor, type ProposalContext } from '../schema/proposal.ts';
import type { DebateStopReason, Mode, Role } from '../schema/types.ts';
import { budgetFor } from './budget.ts';
import { heldPosition, type JobRecord } from './record.ts';
import type { JobState } from './state.ts';

export interface StepKey {
  stepId: string; // 역할 이름, 토론은 BULL-1처럼 라운드를 붙인다
  role: Role;
  round: number | null;
  state: JobState;
}

export const ANALYSTS: Record<Mode, readonly BriefingRole[]> = {
  algorithm: ['TARO', 'DIANA', 'NOVA', 'VIBE'],
  scalp: ['TARO', 'VIBE'],
  forced_direction: ['TARO', 'VIBE'],
};
export const RISK_COMMITTEE = ['RISKY', 'SAFE', 'NEUTRAL'] as const;

/** 토론 2라운드 뒤 남은 호출: ACE 1 + 리스크 3 + PM 1 */
const AFTER_DEBATE_CALLS = 5;

const key = (role: Role, state: JobState, round: number | null = null): StepKey => ({
  stepId: round === null ? role : `${role}-${round}`, role, round, state,
});

/** 지금 실행할 수 있는 단계. 애널리스트는 여러 개(병렬), 그 외에는 하나. 비어 있으면 finalize 차례 */
export function pendingSteps(r: JobRecord): StepKey[] {
  const o = r.outputs;
  const analysts = ANALYSTS[r.mode].filter((role) => !o.briefings[role]);
  if (analysts.length > 0) return analysts.map((role) => key(role, 'ANALYZING'));
  if (r.mode === 'algorithm') {
    if (r.debate.stopReason === null) {
      const n = o.debate.length;
      return [key(n % 2 === 0 ? 'BULL' : 'BEAR', 'DEBATING', Math.floor(n / 2) + 1)];
    }
    if (!o.proposal) return [key('ACE', 'PROPOSING')];
    const reviewer = RISK_COMMITTEE[o.reviews.length];
    if (reviewer) return [key(reviewer, 'RISK_REVIEW')];
    if (!o.pm) return [key('PM', 'FINAL_REVIEW')];
    return [];
  }
  if (!o.blitzPlan) return [key('BLITZ', 'PLANNING')];
  if (!o.briefings.GUARD) return [key('GUARD', 'RISK_REVIEW')];
  if (!o.proposal) return [key('ACE', 'PROPOSING')];
  return [];
}

/**
 * 라운드가 끝난 뒤 토론을 멈출지 (P0-1.4). null이면 다음 라운드를 진행한다.
 * callsUsed는 지금까지 쓴 호출 수(/floor는 역할 발언 수)이고, 다음 라운드와 남은 단계를 합쳐 상한을 넘으면 BUDGET.
 */
export function debateStop(
  round: number, maxRounds: number, bull: DebateMessage, bear: DebateMessage, callsUsed: number, maxCalls: number,
): DebateStopReason | null {
  if (round >= maxRounds) return 'MAX_ROUNDS';
  if (bear.openIssues.length === 0) return 'NO_OPEN_ISSUES';
  if (bear.evidenceRefs.every((ref) => bull.evidenceRefs.includes(ref))) return 'NO_NEW_EVIDENCE';
  if (callsUsed + 2 + AFTER_DEBATE_CALLS > maxCalls) return 'BUDGET';
  return null;
}

export type StepCheck = { ok: true; apply: (r: JobRecord) => void } | { ok: false; errors: SchemaError[] };

function proposalCtx(r: JobRecord, author: ProposalAuthor): ProposalContext {
  if (!r.snapshot || !r.instrumentId || !r.marketType) throw new Error('스냅샷 없는 작업');
  return {
    mode: r.mode, jobId: r.jobId, snapshotId: r.snapshot.snapshotId, instrumentId: r.instrumentId, marketType: r.marketType, author,
    positionId: heldPosition(r)?.id ?? null,
  };
}

/** 역할 출력을 검증하고, 통과하면 작업 기록에 반영하는 함수를 돌려준다 */
export function checkStepOutput(r: JobRecord, step: StepKey, raw: unknown): StepCheck {
  const role = step.role;
  switch (role) {
    case 'BULL':
    case 'BEAR': {
      const c = checkDebate(raw, role, step.round ?? 1);
      if (!c.ok) return c;
      return {
        ok: true,
        apply: (rec) => {
          rec.outputs.debate.push(c.value);
          rec.debate.messageCount = rec.outputs.debate.length;
          rec.debate.roundCount = Math.ceil(rec.debate.messageCount / 2);
          if (role === 'BEAR') {
            const bull = rec.outputs.debate.at(-2)!;
            const used = rec.executionBackend === 'single_session' ? rec.usage.roleTurnCount ?? 0 : rec.usage.modelCallCount;
            rec.debate.stopReason = debateStop(step.round ?? 1, rec.debate.maxRounds, bull, c.value, used, budgetFor(rec.mode).maxModelCalls);
          }
        },
      };
    }
    case 'BLITZ':
    case 'ACE': {
      const c = checkProposal(raw, proposalCtx(r, role));
      if (!c.ok) return c;
      return { ok: true, apply: (rec) => { if (role === 'ACE') rec.outputs.proposal = c.proposal; else rec.outputs.blitzPlan = c.proposal; } };
    }
    case 'PM': {
      const c = checkPm(raw);
      if (!c.ok) return c;
      const ace = r.outputs.proposal;
      if (!ace) return { ok: false, errors: [{ code: 'V-PARSE', path: '$', message: 'ACE 제안 없음' }] };
      let revised = null;
      let modifiedFields: string[] = [];
      if (c.value.pmDecision === 'MODIFY') {
        const p = checkProposal(c.value.revisedProposal, proposalCtx(r, 'PM'));
        if (!p.ok) return { ok: false, errors: p.errors.map((e) => ({ ...e, path: e.path.replace(/^\$/, '$.revisedProposal') })) };
        revised = p.proposal;
        // P0-2-R3: 변경 필드는 PM이 적은 값이 아니라 코드가 계산한 값
        modifiedFields = diffProposalFields(ace, revised);
        if (modifiedFields.length === 0) {
          return { ok: false, errors: [{ code: 'V-PARSE', path: '$.revisedProposal', message: 'MODIFY인데 ACE 제안과 바뀐 필드가 없음 (그대로면 APPROVE)' }] };
        }
      }
      const pm = { ...c.value, revisedProposal: revised, modifiedFields, reportedModifiedFields: c.value.modifiedFields };
      return { ok: true, apply: (rec) => { rec.outputs.pm = pm; } };
    }
    case 'RISKY':
    case 'SAFE':
    case 'NEUTRAL': {
      const c = checkBriefing(raw, r.jobId, role);
      if (!c.ok) return c;
      return { ok: true, apply: (rec) => { rec.outputs.reviews.push(c.value); } };
    }
    default: {
      const c = checkBriefing(raw, r.jobId, role);
      if (!c.ok) return c;
      return { ok: true, apply: (rec) => { rec.outputs.briefings[role] = c.value; } };
    }
  }
}

export function summarizeErrors(errors: SchemaError[]): string {
  return errors.slice(0, 8).map((e) => `${e.code} ${e.path}: ${e.message}`).join('; ') + (errors.length > 8 ? ` 외 ${errors.length - 8}건` : '');
}
