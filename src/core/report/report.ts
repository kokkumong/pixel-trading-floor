// 리포트 (P1 명세 6장). JSON이 원본이고 Markdown은 JSON에서 생성한다 (P1-6-R1).
// 작업 기록과 스냅샷만으로 만드는 순수 함수다. 저장은 store.ts가 한다.
import type { EvidenceIssue } from '../rules/audit.ts';
import type { AnalysisSnapshot } from '../data/snapshot.ts';
import { modelFor } from '../job/budget.ts';
import type { Job } from '../job/engine.ts';
import type { PmReview } from '../job/record.ts';
import type { PositionContext } from '../position/context.ts';
import { RULE_ENGINE_VERSION } from '../rules/engine.ts';
import type { Briefing, BriefingRole, DebateMessage } from '../schema/agents.ts';
import type { FinalDecision } from '../schema/decision.ts';
import type { TradeProposal } from '../schema/proposal.ts';
import type { DebateStopReason, ExecutionBackend, Mode, ResultClass, Role } from '../schema/types.ts';
import { APP_VERSION, CORE_VERSION } from '../version.ts';
import type { CallRecord } from '../job/budget.ts';

/** 3: 진입 시나리오(decision/4 entryPlan) 추가 (P3-6-R4), 2: positionContext 추가 (P2-2-R4). 1·2는 이전 리포트 읽기용 */
export const REPORT_SCHEMA_VERSION = 3;

export interface ReportMeta {
  /** claude --version 결과. 확인할 수 없으면 'unknown', 데모는 'none' */
  claudeCliVersion: string;
}

export interface Report {
  reportSchemaVersion: 1 | 2 | typeof REPORT_SCHEMA_VERSION;
  appVersion: string;
  coreVersion: string;
  interface: 'web' | 'floor';
  executionBackend: ExecutionBackend;
  jobId: string;
  idempotencyKey: string;
  snapshotId: string;
  snapshotHash: string;
  mode: Mode;
  resultClass: ResultClass;
  demo: boolean;
  status: 'COMPLETED';
  symbolInput: string;
  instrumentId: string;
  displayName: string;
  startedAt: string;
  completedAt: string;
  versions: {
    prompts: Partial<Record<Role, string>>;
    /** CLI가 보고한 모델 (P1-6-R4). 보고되지 않으면 unknown */
    models: Partial<Record<Role, string>>;
    /** 설정값 (브라우저 경로만. /floor는 세션 모델을 알 수 없어 비워 둔다) */
    configuredModels: Partial<Record<Role, string>>;
    ruleEngine: string;
    indicators: string;
    calendar: string;
    registry: string;
    claudeCli: string;
  };
  analystIndependence: 'isolated' | 'shared_context';
  budgetEnforcement: 'full' | 'partial';
  retrospective: { enabled: false; reportIds: string[] };
  riskReview: { reviewed: boolean; reviewers: Role[]; timing: 'post_proposal' | 'pre_proposal' };
  usage: {
    plannedModelCallRange: { min: number; max: number };
    modelCallCount: number;
    retryCallCount: number;
    roleTurnCount: number | null;
    durationSeconds: number;
    calls: CallRecord[];
  };
  finalDecision: FinalDecision;
  /** 판정에 쓴 포지션 컨텍스트 전체 (P2-5.1, 재현·수량 검증용). 리포트 v1에는 없다. LAN·ZIP에서는 maskReport로 가린다 */
  positionContext?: PositionContext | null;
  /** BLITZ 계획, ACE 제안, PM 수정안 순서 */
  proposals: TradeProposal[];
  briefings: Partial<Record<BriefingRole, Briefing>>;
  debate: { maxRounds: number; roundCount: number; stopReason: DebateStopReason | null; messages: DebateMessage[] };
  reviews: Briefing[];
  pm: PmReview | null;
  warnings: string[];
  /** 근거 인용 검사 결과 (P1-10-R1·R3·R5) */
  evidenceAudit: EvidenceIssue[];
  /** P1-6-R2 스냅샷 전체 (snapshotHash로 연결) */
  snapshot: AnalysisSnapshot;
}

/** COMPLETED 직전(SAVING)의 작업으로 리포트를 만든다 */
export function buildReport(job: Job, meta: ReportMeta, completedAt: Date): Report {
  const r = job.record;
  const snap = job.snapshot;
  const d = r.finalDecision;
  if (!snap || !r.snapshot) throw new Error('스냅샷 없는 작업은 리포트가 될 수 없음');
  if (!d || !r.instrumentId) throw new Error('최종 판정 없는 작업은 리포트가 될 수 없음');
  const single = r.executionBackend === 'single_session';
  const roles = Object.keys(r.promptHashes) as Role[];

  // P1-6-R4: 역할별 마지막 성공 호출이 보고한 모델
  const models: Partial<Record<Role, string>> = {};
  const configuredModels: Partial<Record<Role, string>> = {};
  for (const role of roles) {
    const call = r.usage.calls.filter((c) => c.role === role && c.outcome === 'ok').at(-1);
    models[role] = call?.modelId ?? 'unknown';
    if (!single) configuredModels[role] = modelFor(role).model;
  }
  const o = r.outputs;
  const proposals = [o.blitzPlan, o.proposal, o.pm?.revisedProposal ?? null].filter((p): p is TradeProposal => p !== null);

  return {
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    coreVersion: CORE_VERSION,
    interface: r.interface,
    executionBackend: r.executionBackend,
    jobId: r.jobId,
    idempotencyKey: r.idempotencyKey,
    snapshotId: r.snapshot.snapshotId,
    snapshotHash: r.snapshot.snapshotHash,
    mode: r.mode,
    resultClass: d.resultClass,
    demo: r.demo,
    status: 'COMPLETED',
    symbolInput: r.symbolInput,
    instrumentId: r.instrumentId,
    displayName: snap.displayName,
    startedAt: r.createdAt,
    completedAt: completedAt.toISOString(),
    versions: {
      prompts: { ...r.promptHashes },
      models,
      configuredModels,
      ruleEngine: RULE_ENGINE_VERSION,
      indicators: snap.versions.indicators,
      calendar: snap.versions.calendar,
      registry: snap.versions.registry,
      claudeCli: meta.claudeCliVersion,
    },
    analystIndependence: single ? 'shared_context' : 'isolated',
    budgetEnforcement: single ? 'partial' : 'full',
    retrospective: { enabled: false, reportIds: [] }, // P1-9
    riskReview: r.mode === 'algorithm'
      ? { reviewed: o.reviews.length > 0, reviewers: o.reviews.map((b) => b.role), timing: 'post_proposal' }
      : { reviewed: Boolean(o.briefings.GUARD), reviewers: o.briefings.GUARD ? ['GUARD'] : [], timing: 'pre_proposal' },
    usage: {
      plannedModelCallRange: { ...r.plannedModelCallRange },
      modelCallCount: r.usage.modelCallCount,
      retryCallCount: r.usage.retryCallCount,
      roleTurnCount: r.usage.roleTurnCount,
      durationSeconds: Math.round((completedAt.getTime() - Date.parse(r.createdAt)) / 100) / 10,
      calls: r.usage.calls,
    },
    finalDecision: d,
    positionContext: r.positionContext ?? null,
    proposals,
    briefings: o.briefings,
    debate: { maxRounds: r.debate.maxRounds, roundCount: r.debate.roundCount, stopReason: r.debate.stopReason, messages: o.debate },
    reviews: o.reviews,
    pm: o.pm,
    warnings: [...r.warnings],
    evidenceAudit: [...(r.evidenceAudit ?? [])],
    snapshot: snap,
  };
}

export type ReportTab = 'analysis' | 'simulation' | 'lightweight' | 'demo';

/** 목록 탭 (P1-6-R8): 데모는 등급과 상관없이 데모 탭 */
export function reportTab(r: Pick<Report, 'demo' | 'resultClass'>): ReportTab {
  return r.demo ? 'demo' : r.resultClass;
}

/** 로컬 시간대 오프셋(분). 동쪽이 양수 */
export function localTzOffsetMinutes(at: Date = new Date()): number {
  return -at.getTimezoneOffset();
}

/**
 * P1-6 파일명: <완료 시각(초, 시간대 포함)>_<instrumentId의 ':'를 '-'로>_<mode>_<jobId 앞 8자>[_SIM|_LITE][_DEMO]
 * 강제 방향 데모는 _SIM_DEMO (P0-5.1 접미사를 유지)
 * 파일명에 쓸 수 없는 ':'는 '-'로 바꾼다 (예: 2026-09-29T15-28-43+09-00)
 */
export function reportBaseName(r: Pick<Report, 'completedAt' | 'instrumentId' | 'mode' | 'jobId' | 'resultClass' | 'demo'>, tzOffsetMinutes: number): string {
  const t = new Date(Date.parse(r.completedAt) + tzOffsetMinutes * 60_000);
  const p2 = (n: number) => String(n).padStart(2, '0');
  const sign = tzOffsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(tzOffsetMinutes);
  const stamp = `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}T${p2(t.getUTCHours())}-${p2(t.getUTCMinutes())}-${p2(t.getUTCSeconds())}${sign}${p2(Math.floor(abs / 60))}-${p2(abs % 60)}`;
  const suffix = (r.resultClass === 'simulation' ? '_SIM' : r.resultClass === 'lightweight' ? '_LITE' : '') + (r.demo ? '_DEMO' : '');
  return `${stamp}_${r.instrumentId.replaceAll(':', '-')}_${r.mode}_${r.jobId.slice(0, 8)}${suffix}`;
}
