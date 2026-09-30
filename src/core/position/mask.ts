// 금액·수량·총 자산 마스킹 (P2 포지션 명세 5.2 R4, 5.3 R6). 평단가·손절 같은 가격과 비율은 남긴다.
// 원본(job.json·reports/*.json)은 그대로 두고, LAN 응답과 ZIP 내보내기에서만 이 사본을 쓴다.
// 가린 자리는 숫자 대신 문자열 "[masked]"가 들어간다. 타입은 원본과 같게 두되 값은 직렬화·표시용으로만 쓴다.
import type { Report } from '../report/report.ts';
import type { FinalDecision, Sizing } from '../schema/decision.ts';
import type { PositionContext } from './context.ts';

export const MASK = '[masked]';
const M = MASK as unknown as number;

/** 수량·손실 한도 금액·기존 리스크·증거금. 비율(%)·기준가·손절은 남긴다 */
export function maskSizing(s: Sizing | null): Sizing | null {
  if (!s) return null;
  return {
    ...s, suggestedQuantity: M, riskBudget: M,
    existingRisk: s.existingRisk === null ? null : M, addableRisk: s.addableRisk === null ? null : M, marginRequired: s.marginRequired === null ? null : M,
  };
}

export function maskDecision(d: FinalDecision): FinalDecision;
export function maskDecision(d: FinalDecision | null): FinalDecision | null;
export function maskDecision(d: FinalDecision | null): FinalDecision | null {
  if (!d) return null;
  return { ...d, sizing: maskSizing(d.sizing ?? null) }; // decision/2에는 sizing이 없다
}

/** 계좌(총 자산·한도)와 보유 수량. 메모는 컨텍스트에 원래 없다 */
export function maskPositionContext(pc: PositionContext | null | undefined): PositionContext | null {
  if (!pc) return null;
  return {
    ...pc,
    account: MASK as unknown as PositionContext['account'],
    position: pc.position ? { ...pc.position, quantity: M } : null,
  };
}

export function maskReport(r: Report): Report {
  return { ...r, finalDecision: maskDecision(r.finalDecision), positionContext: maskPositionContext(r.positionContext) };
}
