// 작업 기록 jobs/<jobId>/job.json의 형식 (P1 명세 1.3 R2). 역할 출력과 호출 기록을 함께 남긴다 (P1-1-R4 부분 결과).
import type { Briefing, BriefingRole, DebateMessage, PmOutput } from '../schema/agents.ts';
import type { FinalDecision } from '../schema/decision.ts';
import type { TradeProposal } from '../schema/proposal.ts';
import type { DebateStopReason, ExecutionBackend, MarketType, Mode, Role } from '../schema/types.ts';
import type { ErrorCode } from '../model/errors.ts';
import type { CallRecord } from './budget.ts';
import { PLANNED_CALLS, type JobState } from './state.ts';

export const MAX_DEBATE_ROUNDS = 2; // P0-1-R1

/** PM 심사 결과. revisedProposal은 검증을 통과한 제안서, modifiedFields는 코드가 계산한 값 (P0-2-R3) */
export interface PmReview extends Omit<PmOutput, 'revisedProposal'> {
  revisedProposal: TradeProposal | null;
  reportedModifiedFields: string[]; // PM이 스스로 적은 값 (참고용)
}

export interface JobOutputs {
  briefings: Partial<Record<BriefingRole, Briefing>>; // 애널리스트와 GUARD
  debate: DebateMessage[];
  blitzPlan: TradeProposal | null;
  proposal: TradeProposal | null; // ACE 제안
  reviews: Briefing[]; // RISKY → SAFE → NEUTRAL
  pm: PmReview | null;
}

export interface JobRecord {
  schemaVersion: 'job/1';
  jobId: string;
  idempotencyKey: string;
  mode: Mode;
  symbolInput: string;
  instrumentId: string | null;
  marketType: MarketType | null;
  interface: 'web' | 'floor';
  executionBackend: ExecutionBackend;
  demo: boolean;
  state: JobState;
  history: { state: JobState; at: string }[];
  createdAt: string;
  error: { code: ErrorCode; message: string; detail: string; role: Role | null } | null;
  snapshot: { path: string; snapshotId: string; snapshotHash: string; collectedAt: string } | null;
  plannedModelCallRange: { min: number; max: number };
  usage: {
    modelCallCount: number;
    retryCallCount: number;
    roleTurnCount: number | null; // single_session(/floor)에서만 (P0-1-R5)
    calls: CallRecord[];
  };
  /** single_session 제출 실패 횟수 (단계 ID별, P1-5-R2) */
  submitRetries: Record<string, number>;
  debate: { maxRounds: number; roundCount: number; messageCount: number; stopReason: DebateStopReason | null };
  outputs: JobOutputs;
  /** 역할별 프롬프트 내용 해시 (P1-6-R3) */
  promptHashes: Partial<Record<Role, string>>;
  warnings: string[];
  finalDecision: FinalDecision | null;
  /** 저장된 리포트 경로 (COMPLETED만, P1-6) */
  report: { json: string; md: string } | null;
  /** 실행 중인 claude 하위 프로세스 (재시작 정리용, P1-1-R5) */
  pids: number[];
}

export interface JobRequest {
  jobId: string;
  idempotencyKey: string;
  mode: Mode;
  symbolInput: string;
  interface: 'web' | 'floor';
  executionBackend?: ExecutionBackend;
  demo?: boolean;
}

export function newJobRecord(req: JobRequest, now: Date): JobRecord {
  const backend = req.executionBackend ?? (req.interface === 'floor' ? 'single_session' : 'subprocess_per_role');
  const at = now.toISOString();
  return {
    schemaVersion: 'job/1',
    jobId: req.jobId,
    idempotencyKey: req.idempotencyKey,
    mode: req.mode,
    symbolInput: req.symbolInput,
    instrumentId: null,
    marketType: null,
    interface: req.interface,
    executionBackend: backend,
    demo: req.demo ?? false,
    state: 'QUEUED',
    history: [{ state: 'QUEUED', at }],
    createdAt: at,
    error: null,
    snapshot: null,
    plannedModelCallRange: { ...PLANNED_CALLS[req.mode] },
    usage: { modelCallCount: 0, retryCallCount: 0, roleTurnCount: backend === 'single_session' ? 0 : null, calls: [] },
    submitRetries: {},
    debate: { maxRounds: req.mode === 'algorithm' ? MAX_DEBATE_ROUNDS : 0, roundCount: 0, messageCount: 0, stopReason: null },
    outputs: { briefings: {}, debate: [], blitzPlan: null, proposal: null, reviews: [], pm: null },
    promptHashes: {},
    warnings: [],
    finalDecision: null,
    report: null,
    pids: [],
  };
}
