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
  NO_SCENARIO_REF: '시나리오 근거 없음',
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
// 참조 값을 옮겨 적었다고 볼 범위 ±1%. 주장에는 지지·저항·손절처럼 참조 값 근처의 다른 가격이 흔해서
// 더 넓히면 오탐이 많다 (Phase 9 데모 fixture 확인). 그보다 크게 틀린 값은 잡지 못한다
const NEAR = 0.01;
const APPROX = 0.05; // '약 84,000', '84,000대', '20여' 같은 어림수의 허용 오차

export interface TextNumber {
  text: string;
  /** 단위 해석 후보. tolerance는 표기 자릿수의 반올림 폭 */
  candidates: { value: number; tolerance: number }[];
  significant: boolean;
  /** 어림수: 일치 판정만 느슨하게 하고 불일치·새 수치로 보지 않는다 */
  approx: boolean;
}

// 식별자 속 숫자(rsi14, ma50, c2)는 뺀다. 부호는 무시하고 절댓값으로 비교한다
const NUM = /(?<![A-Za-z\d_.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(%|만|억|[kK](?![A-Za-z]))?(대|여)?/g;

export function extractNumbers(text: string): TextNumber[] {
  const out: TextNumber[] = [];
  for (const m of text.matchAll(NUM)) {
    const raw = Number(m[1]!.replaceAll(',', '') + (m[2] ? `.${m[2]}` : ''));
    const half = 0.5 * 10 ** -(m[2]?.length ?? 0);
    const unit = m[3];
    const scale = unit === '만' ? 1e4 : unit === '억' ? 1e8 : unit === 'k' || unit === 'K' ? 1e3 : 1;
    const candidates = [{ value: raw * scale, tolerance: half * scale }];
    if (unit === '%') candidates.push({ value: raw / 100, tolerance: half / 100 }); // 비율을 소수로 저장한 값 (펀딩비 등)
    const approx = Boolean(m[4]) || /약\s*$/.test(text.slice(0, m.index));
    // 한 자리 정수(라운드 수, 봉 개수 등)는 새 수치로 보지 않는다
    out.push({ text: m[0], candidates, significant: !approx && (Boolean(m[2] || unit) || raw >= 10), approx });
  }
  return out;
}

const diff = (c: { value: number }, v: number) => Math.abs(c.value - Math.abs(v));
const matches = (n: TextNumber, v: number) =>
  n.candidates.some((c) => diff(c, v) <= c.tolerance || diff(c, v) < (n.approx ? APPROX : MISMATCH) * Math.abs(v));
const gap = (n: TextNumber, v: number) => Math.min(...n.candidates.map((c) => diff(c, v)));

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
      // 참조마다: 본문 숫자 중 하나라도 참조 값과 맞으면 옮겨 적은 것이 맞다. 맞는 숫자 없이 ±1% 안의 숫자만 있으면 잘못 옮긴 것으로 본다
      // 다른 참조 값과 이미 맞는 숫자는 후보에서 뺀다 (sma20처럼 수치 없이 비교에만 인용한 참조가 흔하다)
      const nums = extractNumbers(c.text);
      const all = c.evidenceRefs.flatMap((ref) => numbers(index.value(ref)));
      const loose = nums.filter((n) => !n.approx && !all.some((v) => matches(n, v)));
      for (const ref of c.evidenceRefs) {
        const values = numbers(index.value(ref));
        if (values.some((v) => nums.some((n) => matches(n, v)))) continue;
        let best: { n: TextNumber; v: number } | null = null;
        for (const v of values) {
          for (const n of loose) {
            if (v === 0 || gap(n, v) > NEAR * Math.abs(v)) continue;
            if (!best || gap(n, v) / Math.abs(v) < gap(best.n, best.v) / Math.abs(best.v)) best = { n, v };
          }
        }
        if (best) issue('VALUE_MISMATCH', b.role, { claimId: c.claimId }, ref, `텍스트 ${best.n.text} ↔ 참조 값 ${Number(best.v.toPrecision(10))}`);
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

  for (const p of input.proposals) {
    unresolved(p.author, p.evidenceRefs, {});
    // P3-1-R7: 시나리오마다 유효한 형식의 참조 1개 이상 (proposal/3 이전 기록에는 scenarios가 없다)
    (p.scenarios ?? []).forEach((s, i) => {
      const n = `시나리오 ${i + 1}`;
      for (const ref of s.evidenceRefs) if (!index.has(ref)) issue('UNRESOLVED_REF', p.author, {}, ref, `${n}: ${ref}: 스냅샷·지표·브리핑에 없는 참조`);
      if (s.evidenceRefs.length === 0) issue('NO_SCENARIO_REF', p.author, {}, null, `${n}: 가격 근거 참조(evidenceRefs)가 없음`);
    });
  }
  return out;
}
