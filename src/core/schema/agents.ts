// 제안서 외 역할 출력 스키마: 브리핑(P1 명세 10.1), 토론 발언(P0 명세 1.4), PM 심사(P0 명세 2.4 R3, 보완안 11.3).
// 모델은 *Output만 쓰고 역할·ID·라운드 같은 식별 정보는 시스템이 붙인다.
import { arr, en, nul, obj, parse, parseJsonText, str, type Infer, type ParseResult, type Schema, type SchemaError } from './dsl.ts';
import { ProposalOutputSchema } from './proposal.ts';
import { BIASES, PM_DECISIONS, type Role } from './types.ts';

const ref = () => str({ maxLength: 200 });

export const BriefingOutputSchema = obj({
  claims: arr(
    obj({
      claimId: str({ pattern: /^c\d{1,2}$/, description: 'c1, c2, …' }),
      kind: en(['observation', 'interpretation', 'assumption'] as const),
      text: str({ maxLength: 300 }),
      evidenceRefs: arr(ref(), { maxItems: 6, description: 'observation은 1개 이상 필수' }),
    }),
    { minItems: 1, maxItems: 6 },
  ),
  counterScenario: str({ maxLength: 400 }),
  changeTriggers: arr(str({ maxLength: 160 }), { maxItems: 4 }),
  dataLimitations: arr(str({ maxLength: 160 }), { maxItems: 4 }),
  bias: en(BIASES),
  summary: str({ maxLength: 200, description: '말풍선용 한두 문장' }),
  narrative: str({ maxLength: 1000, description: '콘솔 브리핑. 앞 필드를 되풀이하지 않는 3~5문장' }),
});
export type BriefingOutput = Infer<typeof BriefingOutputSchema>;
export type BriefingRole = Extract<Role, 'TARO' | 'DIANA' | 'NOVA' | 'VIBE' | 'GUARD' | 'RISKY' | 'SAFE' | 'NEUTRAL'>;
export interface Briefing extends BriefingOutput {
  schemaVersion: 'briefing/1';
  briefingId: string; // <jobId>:<역할>
  role: BriefingRole;
}

export const DebateOutputSchema = obj({
  steelman: nul(str({ maxLength: 400 }), { description: '상대의 가장 강한 근거 요약. 첫 BULL 발언은 null' }),
  evidenceRefs: arr(ref(), { maxItems: 10 }),
  openIssues: arr(str({ maxLength: 200 }), { maxItems: 3, description: '상대가 아직 답하지 않은 핵심 쟁점' }),
  summary: str({ maxLength: 200 }),
  narrative: str({ maxLength: 1000 }),
});
export type DebateOutput = Infer<typeof DebateOutputSchema>;
export interface DebateMessage extends DebateOutput {
  speaker: 'BULL' | 'BEAR';
  round: number;
}

export const PmOutputSchema = obj({
  pmDecision: en(PM_DECISIONS),
  modifiedFields: arr(str({ maxLength: 40 }), { maxItems: 20 }),
  reasonCodes: arr(str({ maxLength: 40 }), { maxItems: 10 }),
  revisedProposal: nul(ProposalOutputSchema, { description: 'MODIFY일 때만 수정한 전체 제안서, 그 외 null' }),
  summary: str({ maxLength: 200 }),
  narrative: str({ maxLength: 1000 }),
});
export type PmOutput = Infer<typeof PmOutputSchema>;

/** 문자열 또는 객체로 온 모델 출력을 스키마로 읽는다. */
export function parseOutput<S extends Schema>(schema: S, raw: unknown): ParseResult<Infer<S>> {
  if (typeof raw === 'string') {
    const text = parseJsonText(raw);
    if (!text.ok) return text;
    return parse(schema, text.value);
  }
  return parse(schema, raw);
}

export function checkBriefing(raw: unknown, jobId: string, role: BriefingRole): ParseResult<Briefing> {
  const r = parseOutput(BriefingOutputSchema, raw);
  if (!r.ok) return r;
  const errors: SchemaError[] = [];
  const seen = new Set<string>();
  r.value.claims.forEach((c, i) => {
    if (seen.has(c.claimId)) errors.push({ code: 'V-PARSE', path: `$.claims[${i}].claimId`, message: 'claimId 중복' });
    seen.add(c.claimId);
    if (c.kind === 'observation' && c.evidenceRefs.length === 0) {
      errors.push({ code: 'V-PARSE', path: `$.claims[${i}].evidenceRefs`, message: 'observation은 근거 참조 1개 이상 필수' });
    }
  });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { schemaVersion: 'briefing/1', briefingId: `${jobId}:${role}`, role, ...r.value } };
}

export function checkDebate(raw: unknown, speaker: 'BULL' | 'BEAR', round: number): ParseResult<DebateMessage> {
  const r = parseOutput(DebateOutputSchema, raw);
  if (!r.ok) return r;
  return { ok: true, value: { speaker, round, ...r.value } };
}

/** PM 출력의 구조만 검사한다. revisedProposal의 내용 검증과 변경 필드 계산은 작업 엔진이 checkProposal로 한다. */
export function checkPm(raw: unknown): ParseResult<PmOutput> {
  const r = parseOutput(PmOutputSchema, raw);
  if (!r.ok) return r;
  const pm = r.value;
  if (pm.pmDecision === 'MODIFY' && pm.revisedProposal === null) {
    return { ok: false, errors: [{ code: 'V-PARSE', path: '$.revisedProposal', message: 'MODIFY에는 revisedProposal 필수' }] };
  }
  if (pm.pmDecision !== 'MODIFY' && pm.revisedProposal !== null) {
    return { ok: false, errors: [{ code: 'V-PARSE', path: '$.revisedProposal', message: 'MODIFY가 아니면 null' }] };
  }
  return r;
}
