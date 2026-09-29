// 최종 판정 조립 (P0 명세 3.4). 채택할 제안을 고르고 규칙 엔진을 코드로 적용한다 (P0-3-R2).
// RuleContext는 스냅샷에서 만든다: 가격 소스, 위험 거리 가격, ATR, 근거 참조 색인.
import { derivedValues } from '../data/project.ts';
import type { AnalysisSnapshot } from '../data/snapshot.ts';
import type { EstimatePayload, PricePayload } from '../data/sources.ts';
import { confidenceBand } from '../rules/display.ts';
import { applyRules, type RuleContext } from '../rules/engine.ts';
import { createEvidenceIndex } from '../rules/evidence.ts';
import type { FinalDecision } from '../schema/decision.ts';
import type { TradeProposal } from '../schema/proposal.ts';
import { MODE_META } from '../schema/types.ts';
import type { JobRecord } from './record.ts';

export function ruleContextFor(s: AnalysisSnapshot, briefs: Record<string, readonly string[]>): RuleContext {
  const sources: Record<string, { estimated: boolean; price: number | null }> = {};
  const payloads: Record<string, unknown> = {};
  for (const x of s.sources) {
    // 추정 시세는 V-PRICE-BASIS가 알아보도록 넣고, 사용할 수 없는(실패·만료) 직접 시세는 넣지 않는다
    if (x.endpointType === 'price' && (x.usable || x.estimated)) {
      const p = x.payload as Partial<PricePayload & EstimatePayload> | null;
      sources[x.id] = { estimated: x.estimated, price: p?.last ?? p?.value ?? null };
    }
    if (x.usable) payloads[x.id] = x.payload;
  }
  const perp = s.sources.find((x) => x.id === 'binance.perp.price' && x.usable)?.payload as PricePayload | undefined;
  const riskPrice = s.marketType !== 'perpetual' || !perp ? null
    : perp.mark !== null ? { value: perp.mark, kind: 'mark' as const }
      : perp.last !== null ? { value: perp.last, kind: 'last' as const } : null;
  return {
    mode: s.mode,
    dataQuality: s.dataQuality.status,
    sources,
    riskPrice,
    atr14: s.derived.indicators?.atr14 ?? null,
    evidence: createEvidenceIndex({ snapshot: payloads, derived: derivedValues(s), briefs }),
  };
}

/** 같은 작업의 브리핑 주장 목록 (brief: 참조 검사용) */
function briefIndex(r: JobRecord): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const b of [...Object.values(r.outputs.briefings), ...r.outputs.reviews]) out[b.role] = b.claims.map((c) => c.claimId);
  return out;
}

/** 역할 출력이 모두 모인 작업의 최종 판정 */
export function buildDecision(r: JobRecord, s: AnalysisSnapshot, now: Date): FinalDecision {
  const ace = r.outputs.proposal;
  if (!ace) throw new Error('ACE 제안 없음');
  const meta = MODE_META[r.mode];
  const pm = r.mode === 'algorithm' ? r.outputs.pm : null;
  if (r.mode === 'algorithm' && !pm) throw new Error('PM 심사 없음');
  const rejected = pm?.pmDecision === 'REJECT';
  const adopted: TradeProposal = pm?.pmDecision === 'MODIFY' && pm.revisedProposal ? pm.revisedProposal : ace;

  const o = applyRules(adopted, ruleContextFor(s, briefIndex(r)));
  const reasonCodes = rejected ? ['PM_REJECTED', ...o.reasonCodes.filter((c) => c !== 'NO_EDGE')] : o.reasonCodes;
  const decidedAt = now.toISOString();
  return {
    schemaVersion: 'decision/2',
    jobId: r.jobId,
    snapshotId: s.snapshotId,
    mode: r.mode,
    resultClass: meta.resultClass,
    status: rejected ? 'NO_TRADE' : o.status,
    action: rejected ? 'NO_TRADE' : o.action,
    bias: o.bias,
    unforcedAction: adopted.unforcedAction,
    // P0-2-R4: 기각된 ACE 제안은 판정에 채택하지 않는다 (작업 기록·리포트의 proposals에만 남는다)
    proposal: rejected ? null : adopted,
    decidedAt,
    validUntil: new Date(now.getTime() + o.validForMinutes * 60_000).toISOString(),
    confidence: rejected ? null : { score: adopted.confidence, band: confidenceBand(adopted.confidence), calibrationVersion: 'uncalibrated-v0' },
    reasonCodes,
    ruleEngine: { verdict: o.verdict, violations: o.violations, warnings: o.warnings },
    risk: rejected ? null : o.risk,
    finalDecisionMaker: meta.finalDecisionMaker,
    pmDecision: pm?.pmDecision ?? null,
    modifiedFields: pm?.pmDecision === 'MODIFY' ? pm.modifiedFields : [],
    forcedDirection: r.mode === 'forced_direction',
    executionBackend: r.executionBackend,
  };
}

/** 필수 데이터 부족: 모델 호출 없이 끝난 작업의 판정 (P0-4.5) */
export function insufficientDecision(r: JobRecord, s: AnalysisSnapshot, now: Date): FinalDecision {
  const meta = MODE_META[r.mode];
  return {
    schemaVersion: 'decision/2', jobId: r.jobId, snapshotId: s.snapshotId, mode: r.mode, resultClass: meta.resultClass,
    status: 'INSUFFICIENT_DATA', action: null, bias: null, unforcedAction: null, proposal: null,
    decidedAt: now.toISOString(), validUntil: null, confidence: null, reasonCodes: ['INSUFFICIENT_DATA'],
    ruleEngine: { verdict: 'BLOCKED', violations: [{ code: 'V-DATA-QUALITY', message: '필수 데이터 부족' }], warnings: s.dataQuality.warnings },
    risk: null, finalDecisionMaker: meta.finalDecisionMaker, pmDecision: null, modifiedFields: [],
    forcedDirection: r.mode === 'forced_direction', executionBackend: r.executionBackend,
  };
}
