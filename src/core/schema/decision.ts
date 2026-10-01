// FinalDecision (P0 명세 3.4, v0.3 status 확장, P2 포지션 명세 2.1, P3 신규 진입 명세 4장 decision/4). 시스템이 확정하는 객체이며 모델이 직접 만들지 않는다.
import type { Scenario, TradeProposal } from './proposal.ts';
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

/** 분할 진입 계산 (P3 3.2). 수량은 가중 평균 진입가 기준이며 총 자산이 없으면 null (P3-3-R6) */
export interface TranchePlan {
  avgEntry: number;
  rows: { price: number; weight: number; quantity: number | null; cumulativeQuantity: number | null }[];
  totalQuantity: number | null;
  /** 전부 체결된 뒤 손절까지 갔을 때 손실 금액 (리스크 예산 이하, P3-3-R1) */
  lossAtStop: number | null;
  /** perpetual만: 합계 수량 × 평균 진입가 ÷ 레버리지 */
  marginRequired: number | null;
}

/** 규칙을 통과한 시나리오와 코드가 계산한 파생 값 (P3-4-R2). tranches는 규칙을 통과한 것만 남는다 */
export interface ScenarioPlan extends Scenario {
  /** 첫 목표까지 보상 ÷ 기준 진입가~손절 위험. 기준 진입가는 수량 계산과 같다 */
  rewardRisk: number;
  sizing: Sizing | null;
  risk: RiskInfo | null;
  tranchePlan: TranchePlan | null;
  /** 제거된 분할의 규칙 코드 (V-TRANCHE-SUM·ORDER·SPREAD) */
  trancheViolations: string[];
  /** LOW_REWARD_RISK, TRANCHE_DROPPED */
  warnings: string[];
}

export interface DroppedScenario {
  /** 모델 제안 scenarios 배열에서의 위치 */
  index: number;
  role: Scenario['role'];
  side: Scenario['side'];
  codes: string[];
}

/** 신규 진입 분석의 시나리오·분할 계획 (P3). 판정(action)에는 영향을 주지 않는다 (D31) */
export interface EntryPlan {
  /** 지금 진입안(최상위 entry)의 분할 계획 */
  tranchePlan: TranchePlan | null;
  trancheViolations: string[];
  scenarios: ScenarioPlan[];
  dropped: DroppedScenario[];
  /** NO_WAIT_PLAN, SCN_DROPPED, TRANCHE_DROPPED, NO_EQUITY */
  warnings: string[];
}

export interface RuleResult {
  verdict: RuleVerdict;
  violations: RuleViolation[];
  warnings: string[];
}

export interface FinalDecision {
  /** decision/2(포지션 필드 없음)·decision/3(entryPlan 없음)은 이전 작업·리포트 읽기용이다 (P2-2-R4, P3-6-T3) */
  schemaVersion: 'decision/4';
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
  /** 포지션 보유·강제 방향·판정 없음은 null (P3-1-R2) */
  entryPlan: EntryPlan | null;
}
