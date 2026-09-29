// 화면 표기 규칙. 표시값은 FinalDecision에서 파생하며 저장하지 않는다 (P0 명세 3.1-4).
import type { FinalDecision } from '../schema/decision.ts';
import type { Action, Bias, ConfidenceBand, MarketType } from '../schema/types.ts';

/** action + bias 조합 표기 (P0 명세 3.2) */
export function actionBiasLabel(action: Action, bias: Bias): string {
  if (action === 'ENTER_LONG') return '롱 진입';
  if (action === 'ENTER_SHORT') return '숏 진입';
  return { BULLISH: '거래 없음 · 강세 전망', BEARISH: '거래 없음 · 약세 전망', NEUTRAL: '거래 없음 · 방향 불명확' }[bias];
}

export const BIAS_NOTE = '보유 여부를 모르는 상태의 시장 방향 판단'; // P0 명세 11.2-3

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
export type Tone = 'long' | 'short' | 'neutral' | 'blocked' | 'simulation' | 'error';

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

  if (d.action === null || d.bias === null) {
    return { badges, title: '판정 없음', headline: statusLabel(d.status), tone: 'error', notes };
  }

  let title: string;
  if (d.mode === 'algorithm') {
    title = { APPROVE: 'PM 승인', MODIFY: 'PM 수정승인', REJECT: 'PM 기각 → 거래 없음' }[d.pmDecision ?? 'REJECT'];
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
  const tone: Tone = d.ruleEngine.verdict !== 'PASS' ? 'blocked'
    : d.action === 'ENTER_LONG' ? 'long' : d.action === 'ENTER_SHORT' ? 'short' : 'neutral';
  return { badges, title, headline: actionBiasLabel(d.action, d.bias), tone, notes };
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
