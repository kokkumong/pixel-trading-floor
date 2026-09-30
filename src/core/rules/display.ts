// 화면 표기 규칙. 표시값은 FinalDecision에서 파생하며 저장하지 않는다 (P0 명세 3.1-4).
import type { FinalDecision } from '../schema/decision.ts';
import type { Action, Bias, ConfidenceBand, MarketType } from '../schema/types.ts';

/** action + bias 조합 표기 (P0 명세 3.2, P2 포지션 명세 2.2). 포지션 행동은 판정형으로 쓴다 (P2-6-R1) */
export function actionBiasLabel(action: Action, bias: Bias, sizeFraction: number | null = null): string {
  if (action === 'ENTER_LONG') return '롱 진입';
  if (action === 'ENTER_SHORT') return '숏 진입';
  if (action === 'HOLD') return '유지';
  if (action === 'ADD') return '추가 진입 검토';
  if (action === 'REDUCE') return sizeFraction === null ? '일부 청산 검토' : `일부 청산 검토 (${Math.round(sizeFraction * 100)}%)`;
  if (action === 'EXIT') return '전량 청산 검토';
  return { BULLISH: '거래 없음 · 강세 전망', BEARISH: '거래 없음 · 약세 전망', NEUTRAL: '거래 없음 · 방향 불명확' }[bias];
}

export const BIAS_NOTE = '보유 여부를 모르는 상태의 시장 방향 판단'; // P0 명세 11.2-3
export const POSITION_IGNORED_NOTE = '포지션 무시 시뮬레이션'; // P2-2-R6
export const NO_DECISION_WITH_POSITION = '포지션은 그대로이며 판정이 없음'; // P2-3-R3
export const REVERSAL_NOTE = '반대 방향 진입은 청산 후 새로 분석해 판단합니다'; // P2-2-R2

/** 포지션 규칙 경고 (P2-3). 강한 경고는 판정 표기보다 먼저 보인다 */
const POSITION_ALERTS: Record<string, string> = {
  STOP_ALREADY_HIT: '손절 이미 도달 — 현재가가 보유 손절가를 넘어섬',
  LIQUIDATION_NEAR: '청산가 근접 — 현재가와 청산가 거리가 ATR(14)×2 미만',
};
const POSITION_NOTES: Record<string, string> = {
  STOP_WIDEN_IGNORED: '손절을 넓히는 갱신은 무시하고 기존 손절 유지',
  NO_STOP_ON_POSITION: '보유 포지션에 손절이 없어 추가 진입 수량을 계산하지 않음',
  RISK_BUDGET_FULL: '손실 한도가 이미 차서 추가 진입 여유 없음',
  MARGIN_HEAVY: '필요 증거금이 총 자산의 50%를 넘음',
};

/** 기존 표기(BUY/SELL/HOLD/LONG/SHORT/PASS) 변환 규칙 (P0 명세 3.2) */
export function legacyToActionBias(
  legacy: string,
  marketType: MarketType,
  modelBias: Bias,
): { action: Action; bias: Bias; reasonCodes: string[] } | null {
  switch (legacy.trim().toUpperCase()) {
    case 'BUY':
    case 'LONG':
      return { action: 'ENTER_LONG', bias: 'BULLISH', reasonCodes: [] };
    case 'SHORT':
      return marketType === 'perpetual'
        ? { action: 'ENTER_SHORT', bias: 'BEARISH', reasonCodes: [] }
        : { action: 'NO_TRADE', bias: 'BEARISH', reasonCodes: ['SPOT_SHORT_NOT_ALLOWED'] };
    case 'SELL':
      return marketType === 'perpetual'
        ? { action: 'ENTER_SHORT', bias: 'BEARISH', reasonCodes: [] }
        : { action: 'NO_TRADE', bias: 'BEARISH', reasonCodes: ['SPOT_SHORT_NOT_ALLOWED'] };
    case 'HOLD':
    case 'PASS':
      return { action: 'NO_TRADE', bias: modelBias, reasonCodes: ['NO_EDGE'] };
    default:
      return null;
  }
}

/** 확신도 3단계. 표시 전용이며 어떤 규칙·판정에도 쓰지 않는다 (P0-3-R6). */
export function confidenceBand(score: number): ConfidenceBand {
  if (score >= 70) return 'HIGH';
  if (score >= 50) return 'MEDIUM';
  return 'LOW';
}

export const CONFIDENCE_BAND_LABEL: Record<ConfidenceBand, string> = { LOW: '낮음', MEDIUM: '보통', HIGH: '높음' };
export const CONFIDENCE_NOTE = '보정 전 점수 · 적중 확률이 아님'; // P0-3-R7

/** 판정 색 계열. 규칙 위반은 롱(녹색) 색을 쓰지 않는다 (P0-3-T4), 강제 방향은 전용 색 (P0-5-R4). */
/** caution: 청산 검토·위험 경고 (녹색 금지, P2-6-R4) */
export type Tone = 'long' | 'short' | 'neutral' | 'caution' | 'blocked' | 'simulation' | 'error';

export interface PanelView {
  badges: string[];
  title: string;
  headline: string; // 큰 글씨 판정 표기
  tone: Tone;
  notes: string[];
}

/** 판정 패널 제목과 표기 (P0-2-R2, P0-3.6 forced 예외, P0-5-R6) */
export function panelView(d: FinalDecision, now: Date = new Date()): PanelView {
  const badges: string[] = [];
  const notes: string[] = [];
  if (d.forcedDirection) badges.push('강제 방향 시뮬레이션');
  if (d.ruleEngine.verdict !== 'PASS') badges.push('규칙 차단');
  if (d.validUntil && Date.parse(d.validUntil) < now.getTime()) badges.push('만료');
  if (d.forcedDirection) notes.push(POSITION_IGNORED_NOTE);

  if (d.action === null || d.bias === null) {
    if (d.positionRef) notes.push(NO_DECISION_WITH_POSITION);
    return { badges, title: '판정 없음', headline: statusLabel(d.status), tone: 'error', notes };
  }

  let title: string;
  if (d.mode === 'algorithm') {
    title = { APPROVE: 'PM 승인', MODIFY: 'PM 수정승인', REJECT: d.positionRef ? 'PM 기각 → 유지' : 'PM 기각 → 거래 없음' }[d.pmDecision ?? 'REJECT'];
    if (d.pmDecision === 'MODIFY' && d.modifiedFields.length > 0) notes.push(`변경: ${d.modifiedFields.join(', ')}`);
  } else if (d.mode === 'scalp') {
    title = 'ACE 판정 · GUARD 사전 검토';
  } else {
    title = '강제 방향 시뮬레이션 · 판정 아님';
  }

  if (d.forcedDirection) {
    if (d.ruleEngine.verdict === 'BLOCKED') {
      return { badges, title, headline: '규칙 위반 — 시뮬레이션 무효', tone: 'blocked', notes };
    }
    const u = unforcedLabel(d.action, d.unforcedAction);
    if (u) notes.unshift(u);
    return { badges, title, headline: actionBiasLabel(d.action, d.bias), tone: 'simulation', notes };
  }

  if (d.action === 'NO_TRADE') notes.push(BIAS_NOTE);
  const codes = d.reasonCodes;
  const alerts = Object.keys(POSITION_ALERTS).filter((c) => codes.includes(c)).map((c) => POSITION_ALERTS[c]!);
  if (d.positionRef && d.ruleEngine.verdict === 'DOWNGRADED') {
    notes.push(`규칙에 의해 모델 제안이 조정됨: ${d.ruleEngine.violations.map((v) => v.code).join(', ')}`); // P2-3-R2
  }
  for (const c of Object.keys(POSITION_NOTES)) if (codes.includes(c)) notes.push(POSITION_NOTES[c]!);
  const plan = d.positionPlan;
  if (plan?.stopUpdated) notes.push(`손절 갱신: ${plan.stopLoss}`);
  if (d.sizing) notes.push(`제안 수량 ${d.sizing.suggestedQuantity} (${d.sizing.assumptions.join(' · ')})`); // P2-3-R4
  if (d.action === 'EXIT') notes.push(REVERSAL_NOTE);
  notes.unshift(...alerts);

  let tone: Tone = d.ruleEngine.verdict !== 'PASS' ? 'blocked'
    : d.action === 'ENTER_LONG' ? 'long' : d.action === 'ENTER_SHORT' ? 'short'
      : d.action === 'ADD' ? (plan?.side === 'SHORT' ? 'short' : 'long')
        : d.action === 'REDUCE' || d.action === 'EXIT' ? 'caution' : 'neutral';
  if (tone === 'long' && alerts.length > 0) tone = 'caution';
  return { badges, title, headline: actionBiasLabel(d.action, d.bias, plan?.sizeFraction ?? null), tone, notes };
}

/** 강제 방향 결과의 근거 부족 표기 (P0-5-R6). 방향 표시보다 먼저 보여준다. */
export function unforcedLabel(forcedAction: Action, unforced: Action | null): string | null {
  if (unforced === null) return null;
  if (unforced === 'NO_TRADE') return '근거 부족 — 강제로 고른 방향';
  if (unforced === forcedAction) return '강제 없이도 같은 방향';
  return '강제 없이는 반대 방향 — 신뢰 불가';
}

export function statusLabel(status: FinalDecision['status']): string {
  return {
    VALID: '판정 완료', NO_TRADE: '거래 없음', INSUFFICIENT_DATA: '데이터 부족', UNSUPPORTED_SYMBOL: '지원하지 않는 종목',
    SCHEMA_ERROR: '응답 형식 오류', FAILED: '분석 실패', CANCELLED: '취소됨', BUDGET_EXCEEDED: '상한 도달로 중단',
    INTERRUPTED: '중단됨',
  }[status];
}
