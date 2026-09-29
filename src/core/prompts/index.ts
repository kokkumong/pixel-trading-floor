// 역할별 시스템 프롬프트와 출력 스키마 (P0-4-R7, P0-3-R4, P0-5-R6). 프롬프트 버전은 내용 해시로 자동 계산한다 (P1-6-R3).
// 구성: shared/common + (브리핑 역할: shared/briefing | 제안 역할: shared/proposal + no-trade 또는 forced) + roles/<역할>
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BriefingOutputSchema, DebateOutputSchema, PmOutputSchema } from '../schema/agents.ts';
import { en, toJsonSchema } from '../schema/dsl.ts';
import { ProposalOutputSchema } from '../schema/proposal.ts';
import { ALLOWED_ACTIONS, type Mode, type Role } from '../schema/types.ts';

export const PROMPT_DIR = new URL('./', import.meta.url);

const BRIEFING_ROLES: readonly Role[] = ['TARO', 'DIANA', 'NOVA', 'VIBE', 'GUARD', 'RISKY', 'SAFE', 'NEUTRAL'];

function parts(role: Role, mode: Mode): string[] {
  const out = ['shared/common.md'];
  if (BRIEFING_ROLES.includes(role)) out.push('shared/briefing.md');
  if (role === 'ACE' || role === 'BLITZ' || role === 'PM') {
    out.push('shared/proposal.md', mode === 'forced_direction' && role !== 'PM' ? 'shared/forced.md' : 'shared/no-trade.md');
  }
  out.push(`roles/${role}.md`);
  return out;
}

export interface PromptSet {
  systemPrompt(role: Role, mode: Mode): string;
  /** 실제로 쓰는 프롬프트 전체의 sha256 앞 12자 */
  hash(role: Role, mode: Mode): string;
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
  const systemPrompt = (role: Role, mode: Mode) => parts(role, mode).map(read).join('\n');
  return {
    systemPrompt,
    hash: (role, mode) => createHash('sha256').update(systemPrompt(role, mode)).digest('hex').slice(0, 12),
  };
}

export const prompts: PromptSet = createPromptSet();

/** 강제 방향 모드는 CLI 스키마 단계에서 NO_TRADE를 막는다 (검증 코드 V-ACTION은 그대로 적용) */
const ForcedProposalSchema = {
  ...ProposalOutputSchema,
  props: { ...ProposalOutputSchema.props, action: en(ALLOWED_ACTIONS.forced_direction, { description: 'forced_direction: ENTER_LONG 또는 ENTER_SHORT만' }) },
};

/** claude --json-schema에 넘길 역할별 출력 스키마 */
export function jsonSchemaFor(role: Role, mode: Mode): Record<string, unknown> {
  switch (role) {
    case 'BULL':
    case 'BEAR':
      return toJsonSchema(DebateOutputSchema);
    case 'PM':
      return toJsonSchema(PmOutputSchema);
    case 'ACE':
    case 'BLITZ':
      return toJsonSchema(mode === 'forced_direction' ? ForcedProposalSchema : ProposalOutputSchema);
    default:
      return toJsonSchema(BriefingOutputSchema);
  }
}
