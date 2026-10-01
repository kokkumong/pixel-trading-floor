// 역할별 시스템 프롬프트와 출력 스키마 (P0-4-R7, P0-3-R4, P0-5-R6). 프롬프트 버전은 내용 해시로 자동 계산한다 (P1-6-R3).
// 구성: shared/common + (브리핑 역할: shared/briefing | 제안 역할: shared/proposal + no-trade 또는 forced) + roles/<역할>
// 보유 없는 신규 진입 분석: 제안 역할에 shared/scenarios를 붙인다 (P3-5-R2)
// 보유 포지션이 있는 작업: 제안 역할은 no-trade 대신 shared/position, 포지션을 보는 검토 역할은 shared/position-review를 붙인다 (P2-4-R3)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BriefingOutputSchema, DebateOutputSchema, PmOutputSchema } from '../schema/agents.ts';
import { en, toJsonSchema } from '../schema/dsl.ts';
import { ProposalOutputSchema } from '../schema/proposal.ts';
import { ALLOWED_ACTIONS, ENTRY_ACTIONS, POSITION_ACTIONS, type Mode, type Role } from '../schema/types.ts';

export const PROMPT_DIR = new URL('./', import.meta.url);

const BRIEFING_ROLES: readonly Role[] = ['TARO', 'DIANA', 'NOVA', 'VIBE', 'GUARD', 'RISKY', 'SAFE', 'NEUTRAL'];
const REVIEW_ROLES: readonly Role[] = ['GUARD', 'RISKY', 'SAFE', 'NEUTRAL'];

/** held: 작업에 보유 포지션이 있음 (강제 방향은 항상 false) */
function parts(role: Role, mode: Mode, held: boolean): string[] {
  const out = ['shared/common.md'];
  if (BRIEFING_ROLES.includes(role)) out.push('shared/briefing.md');
  if (held && REVIEW_ROLES.includes(role)) out.push('shared/position-review.md');
  if (role === 'ACE' || role === 'BLITZ' || role === 'PM') {
    const forced = mode === 'forced_direction' && role !== 'PM';
    out.push('shared/proposal.md', forced ? 'shared/forced.md' : held ? 'shared/position.md' : 'shared/no-trade.md');
    if (!forced && !held) out.push('shared/scenarios.md'); // P3-5-R2
  }
  out.push(`roles/${role}.md`);
  return out;
}

export interface PromptSet {
  systemPrompt(role: Role, mode: Mode, held?: boolean): string;
  /** 실제로 쓰는 프롬프트 전체의 sha256 앞 12자 */
  hash(role: Role, mode: Mode, held?: boolean): string;
}

export function createPromptSet(dir: string | URL = PROMPT_DIR): PromptSet {
  const base = typeof dir === 'string' ? dir : fileURLToPath(dir);
  const files = new Map<string, string>();
  const read = (rel: string) => {
    let t = files.get(rel);
    if (t === undefined) {
      t = readFileSync(join(base, rel), 'utf8');
      files.set(rel, t);
    }
    return t;
  };
  const systemPrompt = (role: Role, mode: Mode, held = false) => parts(role, mode, held && mode !== 'forced_direction').map(read).join('\n');
  return {
    systemPrompt,
    hash: (role, mode, held) => createHash('sha256').update(systemPrompt(role, mode, held)).digest('hex').slice(0, 12),
  };
}

export const prompts: PromptSet = createPromptSet();

/** entryPlan: false면 scenarios·tranches를 스키마에서 뺀다 (P3-1-R2. 없는 필드는 읽을 때 []·null로 채워진다) */
const withActions = (actions: readonly string[], description: string, entryPlan = false) => {
  const { scenarios, tranches, ...rest } = ProposalOutputSchema.props;
  return {
    ...ProposalOutputSchema,
    props: { ...rest, action: en(actions, { description }), ...(entryPlan ? { scenarios, tranches } : {}) },
  };
};
/** CLI 스키마 단계에서 모드·포지션 유무에 맞지 않는 행동을 막는다 (검증 코드 V-ACTION·V-POS-STATE는 그대로 적용) */
const ForcedProposalSchema = withActions(ALLOWED_ACTIONS.forced_direction, 'forced_direction: ENTER_LONG 또는 ENTER_SHORT만');
const EntryProposalSchema = withActions(ENTRY_ACTIONS, '보유 포지션 없음: 근거가 약하면 NO_TRADE 선택 가능', true);
const HeldProposalSchema = withActions(POSITION_ACTIONS, '보유 포지션 있음: HOLD·ADD·REDUCE·EXIT 중 하나');

/** claude --json-schema에 넘길 역할별 출력 스키마. held: 작업에 보유 포지션이 있음 */
export function jsonSchemaFor(role: Role, mode: Mode, held = false): Record<string, unknown> {
  switch (role) {
    case 'BULL':
    case 'BEAR':
      return toJsonSchema(DebateOutputSchema);
    case 'PM':
      return toJsonSchema(PmOutputSchema);
    case 'ACE':
    case 'BLITZ':
      return toJsonSchema(mode === 'forced_direction' ? ForcedProposalSchema : held ? HeldProposalSchema : EntryProposalSchema);
    default:
      return toJsonSchema(BriefingOutputSchema);
  }
}
