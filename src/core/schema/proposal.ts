// TradeProposal (P0 명세 3.3). 모델은 ProposalOutput만 쓰고, schemaVersion·jobId·author는 시스템이 붙인다.
import { arr, en, int, nul, num, obj, parse, parseJsonText, str, type Infer, type SchemaError } from './dsl.ts';
import {
  ACTIONS, ALLOWED_ACTIONS, BIASES, CURRENCIES, ENTRY_TYPES, MARKET_TYPES, POSITION_ACTIONS, SIZE_FRACTIONS, TIMEFRAMES,
  type Action, type MarketType, type Mode,
} from './types.ts';

const price = () => num({ exclusiveMin: 0, code: 'V-POSITIVE' });

export const ProposalOutputSchema = obj({
  instrumentId: str({ maxLength: 64, description: '입력의 instrumentId를 그대로 복사' }),
  snapshotId: str({ maxLength: 64, description: '입력의 snapshotId를 그대로 복사' }),
  action: en(ACTIONS, { description: '근거가 약하면 NO_TRADE 선택 가능 (forced_direction 제외)' }),
  bias: en(BIASES),
  unforcedAction: nul(en(ACTIONS), { description: 'forced_direction 모드에서만 값, 그 외 null' }),
  marketType: en(MARKET_TYPES),
  priceBasis: obj({
    sourceRef: str({ maxLength: 80, description: '스냅샷 sources[].id' }),
    currency: en(CURRENCIES),
  }),
  timeframe: en(TIMEFRAMES),
  expectedHoldingPeriod: str({ maxLength: 40 }),
  validForMinutes: int({ min: 1 }),
  entry: obj({
    type: en(ENTRY_TYPES),
    min: nul(price()),
    max: nul(price()),
  }),
  stopLoss: nul(price()),
  targets: arr(price(), { maxItems: 3 }),
  leverage: nul(int({ min: 1 })),
  confidence: int({ min: 0, max: 100, code: 'V-CONF' }),
  rationale: str({ maxLength: 1200 }),
  evidenceRefs: arr(str({ maxLength: 200 }), { maxItems: 20 }),
  invalidationConditions: arr(str({ maxLength: 300 }), { maxItems: 5 }),
  warnings: arr(str({ maxLength: 300 }), { maxItems: 5 }),
  positionRef: nul(str({ maxLength: 64 }), { description: '입력 position.positionRef를 그대로 복사. 포지션 없음이면 null' }),
  sizeFraction: nul(num({ min: 0.25, max: 0.75 }), { description: 'REDUCE에서만 0.25·0.5·0.75 중 하나, 그 외 null' }),
});

export type ProposalOutput = Infer<typeof ProposalOutputSchema>;
export type ProposalAuthor = 'ACE' | 'BLITZ' | 'PM';

/** proposal/2(포지션 필드 없음)는 이전 작업·리포트 읽기용이다 (P2-2-R4) */
export interface TradeProposal extends ProposalOutput {
  schemaVersion: 'proposal/3';
  jobId: string;
  author: ProposalAuthor;
}

export interface ProposalContext {
  mode: Mode;
  jobId: string;
  snapshotId: string;
  instrumentId: string;
  marketType: MarketType;
  author: ProposalAuthor;
  /** 작업에 고정된 포지션 id (강제 방향·포지션 없음은 null) */
  positionId: string | null;
}

export const isPositionAction = (a: Action): boolean => (POSITION_ACTIONS as readonly string[]).includes(a);

export type ProposalCheck = { ok: true; proposal: TradeProposal } | { ok: false; errors: SchemaError[] };

/**
 * 모델 출력(문자열 또는 객체)을 TradeProposal로 확정한다. 여기서 나는 오류는 모두 SCHEMA_ERROR 계열이다
 * (V-PARSE, V-POSITIVE, V-CONF, V-INSTRUMENT, V-ENTRY, V-UNFORCED, V-ACTION, V-POS-STATE).
 */
export function checkProposal(raw: unknown, ctx: ProposalContext): ProposalCheck {
  let value = raw;
  if (typeof raw === 'string') {
    const text = parseJsonText(raw);
    if (!text.ok) return text;
    value = text.value;
  }
  const parsed = parse(ProposalOutputSchema, value);
  if (!parsed.ok) return parsed;
  const p = parsed.value;
  const errors: SchemaError[] = [];
  const err = (code: string, path: string, message: string) => errors.push({ code, path, message });

  if (p.instrumentId !== ctx.instrumentId) err('V-INSTRUMENT', '$.instrumentId', `작업 종목 ${ctx.instrumentId}와 다름`);
  if (p.snapshotId !== ctx.snapshotId) err('V-INSTRUMENT', '$.snapshotId', '작업 스냅샷과 다름');
  // 사용자가 요청하지 않은 시장으로 바꾸지 않는다 (P0 명세 3.2 마지막 문단)
  if (p.marketType !== ctx.marketType) err('V-INSTRUMENT', '$.marketType', `판정 기준 시장은 ${ctx.marketType}`);

  const { type, min, max } = p.entry;
  if (type === 'market') {
    if ((min === null) !== (max === null)) err('V-ENTRY', '$.entry', 'market 진입은 min·max가 둘 다 null이거나 둘 다 값');
    else if (min !== null && max !== null && min > max) err('V-ENTRY', '$.entry', 'min > max');
  } else if (min === null || max === null) {
    err('V-ENTRY', '$.entry', `${type} 진입은 min·max 필수`);
  } else if (type === 'limit' && min !== max) {
    err('V-ENTRY', '$.entry', 'limit 진입은 min = max');
  } else if (type === 'zone' && !(min < max)) {
    err('V-ENTRY', '$.entry', 'zone 진입은 min < max');
  }

  if (ctx.mode === 'forced_direction') {
    if (p.unforcedAction === null) err('V-UNFORCED', '$.unforcedAction', 'forced_direction 모드에서 필수');
  } else if (p.unforcedAction !== null) {
    err('V-UNFORCED', '$.unforcedAction', `${ctx.mode} 모드에서는 null`);
  }
  if (!ALLOWED_ACTIONS[ctx.mode].includes(p.action)) err('V-ACTION', '$.action', `${ctx.mode} 모드에서 허용되지 않는 행동`);

  // V-POS-STATE (P2-2-R1·R5): 포지션 유무와 행동, 참조 id, REDUCE 비율
  const held = ctx.positionId !== null;
  if (held !== isPositionAction(p.action)) {
    err('V-POS-STATE', '$.action', held ? '보유 포지션이 있으면 HOLD·ADD·REDUCE·EXIT 중 하나 (반대 방향은 EXIT 후 재분석)' : '보유 포지션이 없으면 HOLD·ADD·REDUCE·EXIT 불가');
  } else if (p.positionRef !== ctx.positionId) {
    err('V-POS-STATE', '$.positionRef', held ? '입력 position.positionRef와 다름' : '포지션 없음이면 null');
  }
  if (p.action === 'REDUCE' ? !(SIZE_FRACTIONS as readonly number[]).includes(p.sizeFraction ?? -1) : p.sizeFraction !== null) {
    err('V-POS-STATE', '$.sizeFraction', p.action === 'REDUCE' ? 'REDUCE는 0.25·0.5·0.75 중 하나' : 'REDUCE가 아니면 null');
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, proposal: { schemaVersion: 'proposal/3', jobId: ctx.jobId, author: ctx.author, ...p } };
}

/** 두 제안서에서 값이 다른 최상위 필드 이름 (PM MODIFY의 modifiedFields 산출용, P0-2-R3). */
export function diffProposalFields(before: ProposalOutput, after: ProposalOutput): string[] {
  const keys = Object.keys(ProposalOutputSchema.props) as (keyof ProposalOutput)[];
  return keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}
