// 화면·API용 작업 보기. 작업 기록에서 PID와 절대 경로를 빼고, 오류 상세의 홈 경로를 가린다 (P1-7-R13).
import { homedir } from 'node:os';
import type { JobRecord } from '../core/job/record.ts';
import { isTerminal, type JobState } from '../core/job/state.ts';
import { needsDiagnostics } from '../core/live.ts';
import { maskDecision, maskSizing } from '../core/position/mask.ts';
import { panelView, sizingNote, type PanelView } from '../core/rules/display.ts';
import { entryPlanView } from '../core/rules/entryview.ts';
import type { Role } from '../core/schema/types.ts';
import { redact } from './security.ts';

export const DIAGNOSTICS_PATH = '/diagnostics';

export interface JobView {
  jobId: string;
  mode: JobRecord['mode'];
  symbolInput: string;
  instrumentId: string | null;
  marketType: JobRecord['marketType'];
  demo: boolean;
  interface: JobRecord['interface'];
  state: JobState;
  terminal: boolean;
  history: JobRecord['history'];
  createdAt: string;
  error: (NonNullable<JobRecord['error']> & { hint?: string }) | null;
  snapshot: { snapshotId: string; snapshotHash: string; collectedAt: string } | null;
  plannedModelCallRange: JobRecord['plannedModelCallRange'];
  usage: {
    modelCallCount: number;
    retryCallCount: number;
    calls: { role: Role; startedAt: string; durationSeconds: number; outcome: string; retried: boolean; modelId: string | null }[];
  };
  debate: JobRecord['debate'];
  outputs: JobRecord['outputs'];
  warnings: string[];
  evidenceAudit: JobRecord['evidenceAudit'];
  /** 코드가 만든 보유 정보 문구 (다른 시장 보유, 오래된 보유 정보 등, P2-1-R9·R10). 금액·수량 없음 */
  positionNotes: string[];
  finalDecision: JobRecord['finalDecision'];
  panel: PanelView | null;
  reportUrl: string | null;
}

export function jobView(r: JobRecord, now: Date, home: string = homedir()): JobView {
  const clean = (s: string) => redact(s, [], home);
  const d = r.finalDecision;
  return {
    jobId: r.jobId, mode: r.mode, symbolInput: r.symbolInput, instrumentId: r.instrumentId, marketType: r.marketType, demo: r.demo,
    interface: r.interface, state: r.state, terminal: isTerminal(r.state), history: r.history, createdAt: r.createdAt,
    error: r.error ? { ...r.error, detail: clean(r.error.detail), ...(needsDiagnostics(r.error.code) ? { hint: DIAGNOSTICS_PATH } : {}) } : null,
    snapshot: r.snapshot ? { snapshotId: r.snapshot.snapshotId, snapshotHash: r.snapshot.snapshotHash, collectedAt: r.snapshot.collectedAt } : null,
    plannedModelCallRange: r.plannedModelCallRange,
    usage: {
      modelCallCount: r.usage.modelCallCount, retryCallCount: r.usage.retryCallCount,
      calls: r.usage.calls.map((c) => ({ role: c.role, startedAt: c.startedAt, durationSeconds: c.durationSeconds, outcome: c.outcome, retried: c.retried, modelId: c.modelId })),
    },
    debate: r.debate, outputs: r.outputs, warnings: r.warnings.map(clean), evidenceAudit: r.evidenceAudit ?? [], positionNotes: r.positionContext?.notes ?? [], finalDecision: d,
    panel: d && d.action && d.bias ? panelView(d, now, r.positionContext ?? null) : null,
    reportUrl: r.report ? `/reports/${r.jobId}` : null,
  };
}

/** LAN 기기에 보내는 작업 보기: 수량 제안과 시나리오의 금액·수량을 가린다 (P2-5-R6, P3-6-R4). 보유 요약(가격·비율)과 문구는 남긴다 */
export function maskJobView(v: JobView): JobView {
  const d = v.finalDecision;
  if (!d || (!d.sizing && !d.entryPlan)) return v;
  const s = d.sizing;
  const hidden = s ? sizingNote(maskSizing(s)!) : '';
  const shown = s ? sizingNote(s) : null;
  const masked = maskDecision(d);
  return {
    ...v,
    finalDecision: masked,
    // 시나리오 카드의 수량·손실 금액도 가린 판정에서 다시 만든다 (P3-6-R4)
    panel: v.panel && { ...v.panel, notes: v.panel.notes.map((n) => (n === shown ? hidden : n)), entryPlan: entryPlanView(masked) },
  };
}
