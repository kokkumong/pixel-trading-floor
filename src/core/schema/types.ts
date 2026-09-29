// 공통 열거형 (P0 명세 1.3, 2.3, 3.2~3.4 / P1 명세 1.1). enum 대신 as const 배열과 유니온 타입을 쓴다.

export const MODES = ['algorithm', 'scalp', 'forced_direction'] as const;
export type Mode = (typeof MODES)[number];

export const ACTIONS = ['ENTER_LONG', 'ENTER_SHORT', 'NO_TRADE'] as const;
export type Action = (typeof ACTIONS)[number];

export const BIASES = ['BULLISH', 'BEARISH', 'NEUTRAL'] as const;
export type Bias = (typeof BIASES)[number];

export const MARKET_TYPES = ['spot', 'perpetual'] as const;
export type MarketType = (typeof MARKET_TYPES)[number];

export const CURRENCIES = ['KRW', 'USD', 'USDT'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const TIMEFRAMES = ['15m', '1h', '4h', '1d'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const ENTRY_TYPES = ['market', 'limit', 'zone'] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const ROLES = [
  'TARO', 'DIANA', 'NOVA', 'VIBE',
  'BULL', 'BEAR',
  'BLITZ', 'GUARD',
  'RISKY', 'SAFE', 'NEUTRAL',
  'ACE', 'PM',
] as const;
export type Role = (typeof ROLES)[number];

export const RESULT_CLASSES = ['analysis', 'simulation', 'lightweight'] as const;
export type ResultClass = (typeof RESULT_CLASSES)[number];

export const DECISION_STATUSES = [
  'VALID', 'NO_TRADE', 'INSUFFICIENT_DATA', 'UNSUPPORTED_SYMBOL', 'SCHEMA_ERROR',
  'FAILED', 'CANCELLED', 'BUDGET_EXCEEDED', 'INTERRUPTED',
] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const RULE_VERDICTS = ['PASS', 'DOWNGRADED', 'BLOCKED'] as const;
export type RuleVerdict = (typeof RULE_VERDICTS)[number];

export const PM_DECISIONS = ['APPROVE', 'MODIFY', 'REJECT'] as const;
export type PmDecision = (typeof PM_DECISIONS)[number];

export const DEBATE_STOP_REASONS = ['MAX_ROUNDS', 'NO_OPEN_ISSUES', 'NO_NEW_EVIDENCE', 'BUDGET'] as const;
export type DebateStopReason = (typeof DEBATE_STOP_REASONS)[number];

export const CONFIDENCE_BANDS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type ConfidenceBand = (typeof CONFIDENCE_BANDS)[number];

export const EXECUTION_BACKENDS = ['subprocess_per_role', 'single_session'] as const;
export type ExecutionBackend = (typeof EXECUTION_BACKENDS)[number];

export const DATA_QUALITY_STATUSES = ['OK', 'PARTIAL_DATA', 'INSUFFICIENT_DATA'] as const;
export type DataQualityStatus = (typeof DATA_QUALITY_STATUSES)[number];

/** 모드별 허용 행동 (P0 명세 2.2) */
export const ALLOWED_ACTIONS: Record<Mode, readonly Action[]> = {
  algorithm: ACTIONS,
  scalp: ACTIONS,
  forced_direction: ['ENTER_LONG', 'ENTER_SHORT'],
};

/** 모드별 결과 등급과 최종 의사결정자 (P0 명세 2.2) */
export const MODE_META: Record<Mode, { resultClass: ResultClass; finalDecisionMaker: 'PM' | 'ACE' }> = {
  algorithm: { resultClass: 'analysis', finalDecisionMaker: 'PM' },
  scalp: { resultClass: 'analysis', finalDecisionMaker: 'ACE' },
  forced_direction: { resultClass: 'simulation', finalDecisionMaker: 'ACE' },
};

/** V-VALIDITY: 모드별 validForMinutes 상한 (P0 명세 3.6) */
export const MAX_VALID_MINUTES: Record<Mode, number> = {
  algorithm: 10_080,
  scalp: 240,
  forced_direction: 240,
};

export const MAX_LEVERAGE = 20;
