// FinalDecision (P0 명세 3.4, v0.3 status 확장, P2 포지션 명세 2.1 decision/3). 시스템이 확정하는 객체이며 모델이 직접 만들지 않는다.
import type { TradeProposal } from './proposal.ts';
import type {
  Action, Bias, Currency, ConfidenceBand, DecisionStatus, ExecutionBackend, Mode, PmDecision, ResultClass, RuleVerdict,
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

/** 포지션 인지 판정에서 보유 포지션에 적용할 값 (P2-2-R5, P2-3 V-STOP-WIDEN·V-EXIT-CONSISTENCY 반영) */
export interface PositionPlan {
  positionRef: string;
  side: 'LONG' | 'SHORT';
  /** 판정 뒤 손절 (갱신이 무시되거나 강등되면 기존 값) */
  stopLoss: number | null;
  targets: number[];
  stopUpdated: boolean;
  /** REDUCE 비율, 그 외 null */
  sizeFraction: number | null;
}

/** 리스크 예산 수량 제안 (P2-3.3). 코드가 계산하며 모델은 이 값을 모른다 (P2-3-R4) */
export interface Sizing {
  suggestedQuantity: number;
  currency: Currency;
  riskPerTradePercent: number;
  riskBudget: number;
  entryPrice: number;
  stopLoss: number;
  /** ADD만: 기존 포지션이 손절까지 갈 때의 손실과 남은 예산 */
  existingRisk: number | null;
  addableRisk: number | null;
  /** perpetual만: 제안 수량 × 기준가 ÷ 레버리지 */
  marginRequired: number | null;
  assumptions: string[];
}

export interface RuleResult {
  verdict: RuleVerdict;
  violations: RuleViolation[];
  warnings: string[];
}

export interface FinalDecision {
  /** decision/2(포지션 필드 없음)는 이전 작업·리포트 읽기용이다 (P2-2-R4) */
  schemaVersion: 'decision/3';
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
  /** 판정에 쓴 보유 포지션 id. 포지션 없음·강제 방향은 null */
  positionRef: string | null;
  positionPlan: PositionPlan | null;
  sizing: Sizing | null;
}
