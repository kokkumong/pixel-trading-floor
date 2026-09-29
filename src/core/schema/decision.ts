// FinalDecision (P0 명세 3.4, v0.3 status 확장). 시스템이 확정하는 객체이며 모델이 직접 만들지 않는다.
import type { TradeProposal } from './proposal.ts';
import type {
  Action, Bias, ConfidenceBand, DecisionStatus, ExecutionBackend, Mode, PmDecision, ResultClass, RuleVerdict,
} from './types.ts';

export interface RuleViolation {
  code: string;
  message: string;
}

/** P1 명세 4.3 레버리지 위험 거리. 거래소별 청산가는 계산하지 않는다. */
export interface RiskInfo {
  leverage: number;
  marginMode: 'unspecified';
  liquidationEstimateType: 'rough';
  estimatedLiquidationPrice: null; // P1-4-R2
  assumedMaintenanceMargin: number;
  basePrice: number;
  basePriceKind: 'mark' | 'last' | 'entry';
  roughMarginLimitPercent: number;
  roughMarginLimitPrice: number;
  stopDistancePercent: number;
  bufferRatio: number;
  assumptions: string[];
}

export interface RuleResult {
  verdict: RuleVerdict;
  violations: RuleViolation[];
  warnings: string[];
}

export interface FinalDecision {
  schemaVersion: 'decision/2';
  jobId: string;
  snapshotId: string;
  mode: Mode;
  resultClass: ResultClass;
  status: DecisionStatus;
  action: Action | null; // status가 VALID·NO_TRADE일 때만 값
  bias: Bias | null;
  unforcedAction: Action | null;
  proposal: TradeProposal | null; // 최종 채택된 제안
  decidedAt: string;
  validUntil: string | null;
  confidence: { score: number; band: ConfidenceBand; calibrationVersion: 'uncalibrated-v0' } | null;
  reasonCodes: string[];
  ruleEngine: RuleResult;
  risk: RiskInfo | null;
  finalDecisionMaker: 'PM' | 'ACE';
  pmDecision: PmDecision | null;
  modifiedFields: string[];
  forcedDirection: boolean;
  executionBackend: ExecutionBackend;
}
