// 근거 인용 검사 (P1 명세 10.2·10.3). 경고만 남기고 판정은 바꾸지 않는다.
// ACE 제안의 유효 근거 수로 강등하는 규칙(P1-10-R2)은 규칙 엔진(V-EVIDENCE-REF)이 맡는다.
//   UNRESOLVED_REF   모든 역할 출력의 evidenceRefs 존재 검사 (P1-10-R1)
//   VALUE_MISMATCH   observation 주장의 수치 ↔ 참조 값 상대 오차 0.5% 이상 (P1-10-R3, 권장)
//   NO_BRIEF_REF     BULL·BEAR 발언에 유효한 brief: 인용이 없음 (P1-10-R5)
//   UNSOURCED_NUMBER BULL·BEAR가 브리핑에 없는 수치를 snap:·derived: 근거 없이 씀 (P1-10-R5)
import type { Briefing, DebateMessage } from '../schema/agents.ts';
import type { TradeProposal } from '../schema/proposal.ts';
import type { Role } from '../schema/types.ts';
import { parseRef, type EvidenceIndex } from './evidence.ts';

export const EVIDENCE_ISSUE_LABEL = {
  UNRESOLVED_REF: '근거 확인 불가',
  VALUE_MISMATCH: '수치 불일치',
  NO_BRIEF_REF: '브리핑 인용 없음',
  UNSOURCED_NUMBER: '근거 없는 새 수치',
} as const;
export type EvidenceIssueKind = keyof typeof EVIDENCE_ISSUE_LABEL;

export interface EvidenceIssue {
  kind: EvidenceIssueKind;
  label: (typeof EVIDENCE_ISSUE_LABEL)[EvidenceIssueKind];
  role: Role;
  /** 토론 발언의 라운드 */
  round: number | null;
  /** 브리핑·리스크 검토 주장의 claimId */
  claimId: string | null;
  ref: string | null;
  detail: string;
}

export interface AuditInput {
  /** 애널리스트·GUARD 브리핑 (토론이 인용하는 대상) */
  briefings: readonly Briefing[];
  /** RISKY·SAFE·NEUTRAL */
  reviews: readonly Briefing[];
  debate: readonly DebateMessage[];
  /** BLITZ 계획, ACE 제안, PM 수정안 */
  proposals: readonly TradeProposal[];
}

const MISMATCH = 0.005; // P1-10-R3 상대 오차 0.5%
const NEAR = 0.1; // 참조 값의 ±10% 안에 있는 숫자만 그 값을 옮겨 적은 것으로 본다 (다른 숫자는 비교하지 않는다)

export interface TextNumber {
  text: string;
  /** 단위 해석 후보. tolerance는 표기 자릿수의 반올림 폭 */
  candidates: { value: number; tolerance: number }[];
  significant: boolean;
}

// 식별자 속 숫자(rsi14, ma50, c2)는 뺀다. 부호는 무시하고 절댓값으로 비교한다
const NUM = /(?<![A-Za-z\d_.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(%|만|억|[kK](?![A-Za-z]))?/g;

export function extractNumbers(text: string): TextNumber[] {
  const out: TextNumber[] = [];
  for (const m of text.matchAll(NUM)) {
    const raw = Number(m[1]!.replaceAll(',', '') + (m[2] ? `.${m[2]}` : ''));
    const half = 0.5 * 10 ** -(m[2]?.length ?? 0);
    const unit = m[3];
    const scale = unit === '만' ? 1e4 : unit === '억' ? 1e8 : unit === 'k' || unit === 'K' ? 1e3 : 1;
    const candidates = [{ value: raw * scale, tolerance: half * scale }];
    if (unit === '%') candidates.push({ value: raw / 100, tolerance: half / 100 }); // 비율을 소수로 저장한 값 (펀딩비 등)
    // 한 자리 정수(라운드 수, 봉 개수 등)는 새 수치로 보지 않는다
    out.push({ text: m[0], candidates, significant: Boolean(m[2] || unit) || raw >= 10 });
  }
  return out;
}

const diff = (c: { value: number }, v: number) => Math.abs(c.value - Math.abs(v));
const matches = (n: TextNumber, v: number) => n.candidates.some((c) => diff(c, v) <= c.tolerance || diff(c, v) < MISMATCH * Math.abs(v));
const near = (n: TextNumber, v: number) => v !== 0 && n.candidates.some((c) => diff(c, v) <= NEAR * Math.abs(v));

/** 참조 값의 숫자: 스칼라, 또는 객체·배열의 한 단계 숫자 필드 */
function numbers(v: unknown): number[] {
  if (typeof v === 'number') return Number.isFinite(v) ? [v] : [];
  if (typeof v !== 'object' || v === null) return [];
  return Object.values(v).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
}

export function auditEvidence(input: AuditInput, index: EvidenceIndex): EvidenceIssue[] {
  const out: EvidenceIssue[] = [];
  const issue = (kind: EvidenceIssueKind, role: Role, at: { round?: number; claimId?: string }, ref: string | null, detail: string) =>
    out.push({ kind, label: EVIDENCE_ISSUE_LABEL[kind], role, round: at.round ?? null, claimId: at.claimId ?? null, ref, detail });
  const unresolved = (role: Role, refs: readonly string[], at: { round?: number; claimId?: string }) => {
    for (const ref of refs) if (!index.has(ref)) issue('UNRESOLVED_REF', role, at, ref, `${ref}: 스냅샷·지표·브리핑에 없는 참조`);
  };

  for (const b of [...input.briefings, ...input.reviews]) {
    for (const c of b.claims) {
      unresolved(b.role, c.evidenceRefs, { claimId: c.claimId });
      if (c.kind !== 'observation') continue;
      const refValues = c.evidenceRefs.flatMap((ref) => numbers(index.value(ref)).map((value) => ({ ref, value })));
      if (refValues.length === 0) continue;
      for (const n of extractNumbers(c.text)) {
        const close = refValues.filter((r) => near(n, r.value));
        if (close.length === 0 || refValues.some((r) => matches(n, r.value))) continue;
        const best = close.reduce((a, r) => (Math.abs(r.value - n.candidates[0]!.value) < Math.abs(a.value - n.candidates[0]!.value) ? r : a));
        issue('VALUE_MISMATCH', b.role, { claimId: c.claimId }, best.ref, `텍스트 ${n.text} ↔ 참조 값 ${best.value}`);
      }
    }
  }

  // 토론이 그대로 옮겨도 되는 수치: 브리핑 본문의 숫자와 브리핑이 인용한 참조 값
  const pool: number[] = [];
  for (const b of input.briefings) {
    const texts = [b.summary, b.narrative, b.counterScenario, ...b.changeTriggers, ...b.claims.map((c) => c.text)];
    for (const n of extractNumbers(texts.join('\n'))) pool.push(n.candidates[0]!.value);
    for (const c of b.claims) for (const ref of c.evidenceRefs) pool.push(...numbers(index.value(ref)));
  }
  for (const d of input.debate) {
    const at = { round: d.round };
    unresolved(d.speaker, d.evidenceRefs, at);
    const valid = d.evidenceRefs.filter((ref) => index.has(ref)).map((ref) => parseRef(ref)?.kind);
    if (!valid.includes('brief')) issue('NO_BRIEF_REF', d.speaker, at, null, '애널리스트 브리핑을 brief: 참조로 인용하지 않음');
    if (valid.includes('snap') || valid.includes('derived')) continue;
    const text = [d.steelman ?? '', d.summary, d.narrative, ...d.openIssues].join('\n');
    const fresh = extractNumbers(text).filter((n) => n.significant && !pool.some((v) => matches(n, v)));
    if (fresh.length) issue('UNSOURCED_NUMBER', d.speaker, at, null, `브리핑에 없는 수치 ${fresh.map((n) => n.text).join(', ')} (snap:·derived: 근거 없음)`);
  }

  for (const p of input.proposals) unresolved(p.author, p.evidenceRefs, {});
  return out;
}
