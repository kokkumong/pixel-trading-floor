// 진입 시나리오·분할 진입의 표시 문구 (P3 명세 6장). 화면과 리포트 Markdown이 같은 결과를 쓴다.
// decision.entryPlan(규칙 통과분)만 읽고 모델 원본(proposal.scenarios)은 읽지 않는다.
import type { EntryPlan, FinalDecision, ScenarioPlan, Sizing, TranchePlan } from '../schema/decision.ts';

export const SCENARIO_HEADING = '진입 시나리오';
export const SCENARIO_NOTICE = '조건 미충족 — 아직 진입 신호가 아님'; // P3-1-R1
export const SCENARIO_EXPIRED = '만료됨 — 다시 분석하세요'; // P3-1-R6
/** D28: 트리거는 설명용이다 */
export const NO_WATCH_NOTE = '앱은 가격을 감시하지 않고 주문도 내지 않습니다. 조건 충족 여부는 직접 확인하고, 재확인 시점에 다시 분석하세요.';
export const NO_WAIT_PLAN_NOTE = '재진입 조건이 제시되지 않음'; // P3-2-R1
export const NO_EQUITY_NOTE = '총 자산이 입력되지 않아 수량을 계산하지 않음 (포지션 화면에서 총 자산 입력)'; // P3-3-R6
export const TRANCHE_RULE_NOTE = '1차 체결 후 무효화 조건에 해당하면 남은 분할은 진입하지 않는다. 앱은 주문을 내지 않으므로 직접 실행한다.'; // P3-3-R7

export interface TrancheTable {
  rows: { label: string; price: string; weight: string; quantity: string | null; cumulative: string | null }[];
  /** 평균 진입가·합계 수량·전부 체결 시 손절 손실·필요 증거금 (P3-3-R3, P3-6-R3) */
  summary: string[];
  note: string;
}

export interface ScenarioCard {
  /** 예: `롱 · 눌림 · 주 시나리오`. 방향은 텍스트로만 구분한다 (P3-6-R2) */
  title: string;
  side: 'LONG' | 'SHORT';
  /** 예: `재확인 1시간 뒤` (P3-2-R3) */
  recheck: string;
  condition: string;
  fields: { label: string; value: string }[];
  tranches: TrancheTable | null;
  invalidation: string[];
  rationale: string;
  /** 경고색으로 표시한다 (LOW_REWARD_RISK, 분할 제외) */
  warnings: string[];
}

export interface EntryPlanView {
  heading: string;
  notice: string;
  expiredNotice: string;
  guide: string;
  /** 시나리오 만료 시각 = 판정의 validUntil (P3-1-R6). 화면이 현재 시각과 비교한다 */
  validUntil: string | null;
  cards: ScenarioCard[];
  /** 지금 진입안(최상위 entry)의 분할 계획 */
  mainTranches: TrancheTable | null;
  /** 경고색으로 표시한다 (NO_WAIT_PLAN, 제외된 시나리오 수, 총 자산 없음) */
  warnings: string[];
}

const SIDE = { LONG: '롱', SHORT: '숏' } as const;
const ROLE = { PRIMARY: '주 시나리오', ALTERNATE: '대안 시나리오' } as const;

/** 분 → `45분`·`1시간 30분`·`2일` */
export function minutesLabel(m: number): string {
  if (m < 60) return `${m}분`;
  if (m >= 2880 && m % 1440 === 0) return `${m / 1440}일`;
  const h = Math.floor(m / 60);
  return m % 60 === 0 ? `${h}시간` : `${h}시간 ${m % 60}분`;
}

const pct = (w: number) => `${Number((w * 100).toFixed(1))}%`;
const uniq = (xs: string[]) => [...new Set(xs)];

/** sizing이 없으면(총 자산 없음) 가격·비중만 표시한다 (P3-3-R6). 마스킹된 값은 문자열 그대로 나온다 */
function trancheTable(tp: TranchePlan | null, sizing: Sizing | null): TrancheTable | null {
  if (!tp) return null;
  const q = (x: number | null) => (x === null ? null : String(x));
  const summary = [`평균 진입가 ${tp.avgEntry}`];
  if (tp.totalQuantity !== null) summary.push(`합계 수량 ${tp.totalQuantity}`);
  if (tp.lossAtStop !== null && sizing) {
    summary.push(`전부 체결 시 손절 손실 ${tp.lossAtStop} ${sizing.currency} ≤ 총 자산의 ${sizing.riskPerTradePercent}%`);
  }
  if (tp.marginRequired !== null) summary.push(`필요 증거금 ${tp.marginRequired}`);
  if (sizing) summary.push(`가정: ${sizing.assumptions.join(' · ')}`);
  return {
    rows: tp.rows.map((r, i) => ({ label: `${i + 1}차`, price: String(r.price), weight: pct(r.weight), quantity: q(r.quantity), cumulative: q(r.cumulativeQuantity) })),
    summary,
    note: TRANCHE_RULE_NOTE,
  };
}

function card(s: ScenarioPlan): ScenarioCard {
  const long = s.side === 'LONG';
  const { kind, level, timeframe, confirmation } = s.trigger;
  const kindLabel = kind === 'PULLBACK' ? (long ? '눌림' : '반등') : long ? '돌파' : '이탈';
  const move = kind === 'PULLBACK' ? (long ? `가격이 ${level}까지 내려옴` : `가격이 ${level}까지 올라옴`) : long ? `가격이 ${level} 위로 돌파` : `가격이 ${level} 아래로 이탈`;
  const fields = [
    { label: '진입 구간', value: s.entry.min === s.entry.max ? `${s.entry.min} (지정가)` : `${s.entry.min} ~ ${s.entry.max}` },
    { label: '손절', value: String(s.stopLoss) },
    { label: '목표', value: s.targets.join(' · ') },
    { label: '손익비', value: `${s.rewardRisk} (첫 목표 기준)` },
  ];
  if (s.leverage !== null) fields.push({ label: '레버리지', value: `${s.leverage}배${s.risk ? ` · 손절 거리 ${Number(s.risk.stopDistancePercent.toFixed(2))}%` : ''}` });
  if (s.sizing && !s.tranchePlan) fields.push({ label: '수량', value: `${s.sizing.suggestedQuantity} (${s.sizing.assumptions.join(' · ')})` });
  const warnings: string[] = [];
  if (s.warnings.includes('LOW_REWARD_RISK')) warnings.push(`손익비 낮음: 첫 목표까지 보상이 손절 위험의 ${s.rewardRisk}배`);
  if (s.trancheViolations.length > 0) warnings.push(`분할 진입 계획이 규칙 검사에서 제외됨 (${s.trancheViolations.join(', ')}) — 단일 진입 기준`);
  return {
    title: `${SIDE[s.side]} · ${kindLabel} · ${ROLE[s.role]}`,
    side: s.side,
    recheck: `재확인 ${minutesLabel(s.recheckAfterMinutes)} 뒤`,
    condition: `조건 (${timeframe}): ${move} — ${confirmation}`,
    fields,
    tranches: trancheTable(s.tranchePlan, s.sizing),
    invalidation: s.invalidationConditions,
    rationale: s.rationale,
    warnings,
  };
}

function planWarnings(e: EntryPlan, hasPlan: boolean): string[] {
  const out: string[] = [];
  if (e.warnings.includes('NO_WAIT_PLAN')) out.push(NO_WAIT_PLAN_NOTE);
  if (e.dropped.length > 0) {
    out.push(`규칙 검사에서 제외된 시나리오 ${e.dropped.length}건 (${uniq(e.dropped.flatMap((x) => x.codes)).join(', ')})`); // P3-4-T2
  }
  if (e.trancheViolations.length > 0) out.push(`지금 진입안의 분할 계획이 규칙 검사에서 제외됨 (${e.trancheViolations.join(', ')}) — 단일 진입 기준`);
  if (hasPlan && e.warnings.includes('NO_EQUITY')) out.push(NO_EQUITY_NOTE);
  return out;
}

/**
 * 판정 패널·리포트의 진입 시나리오 영역. 보유·강제 방향·판정 없음(entryPlan = null)과 decision/3 이전 기록은 null (P3-1-R2, P3-6-T3).
 * 시나리오·분할·경고가 하나도 없는 진입 판정도 null이다 (영역을 그리지 않는다).
 */
export function entryPlanView(d: Pick<FinalDecision, 'entryPlan' | 'validUntil' | 'sizing'>): EntryPlanView | null {
  const e = d.entryPlan;
  if (!e) return null;
  const cards = e.scenarios.map(card);
  const mainTranches = trancheTable(e.tranchePlan, d.sizing ?? null);
  const warnings = planWarnings(e, cards.length > 0 || mainTranches !== null);
  if (cards.length === 0 && !mainTranches && warnings.length === 0) return null;
  return {
    heading: SCENARIO_HEADING, notice: SCENARIO_NOTICE, expiredNotice: SCENARIO_EXPIRED, guide: NO_WATCH_NOTE,
    validUntil: d.validUntil, cards, mainTranches, warnings,
  };
}
