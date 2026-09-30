import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIDENCE_BAND_LABEL, CONFIDENCE_NOTE, confidenceBand, legacyToActionBias, panelView,
} from '../../src/core/rules/display.ts';
import type { FinalDecision } from '../../src/core/schema/decision.ts';
import { JOB, SNAP, proposal } from '../helpers.ts';

function decision(over: Partial<FinalDecision> = {}): FinalDecision {
  return {
    schemaVersion: 'decision/3', jobId: JOB, snapshotId: SNAP, mode: 'algorithm', resultClass: 'analysis',
    status: 'VALID', action: 'ENTER_LONG', bias: 'BULLISH', unforcedAction: null, proposal: proposal(),
    decidedAt: '2026-09-29T00:00:00Z', validUntil: '2026-09-29T02:00:00Z',
    confidence: { score: 62, band: 'MEDIUM', calibrationVersion: 'uncalibrated-v0' },
    reasonCodes: [], ruleEngine: { verdict: 'PASS', violations: [], warnings: [] }, risk: null,
    finalDecisionMaker: 'PM', pmDecision: 'APPROVE', modifiedFields: [], forcedDirection: false,
    executionBackend: 'subprocess_per_role', positionRef: null, positionPlan: null, sizing: null,
    ...over,
  };
}
const at = new Date('2026-09-29T01:00:00Z');

test('확신도 3단계 경계 (P0-3-R6)', () => {
  assert.deepEqual([0, 49, 50, 69, 70, 100].map(confidenceBand), ['LOW', 'LOW', 'MEDIUM', 'MEDIUM', 'HIGH', 'HIGH']);
});

test('P0-3-T6 확신도 표기에 %가 없다', () => {
  assert.equal([...Object.values(CONFIDENCE_BAND_LABEL), CONFIDENCE_NOTE].some((s) => s.includes('%')), false);
});

test('P0-2-R2 판정 패널 제목 표', () => {
  assert.equal(panelView(decision(), at).title, 'PM 승인');
  const mod = panelView(decision({ pmDecision: 'MODIFY', modifiedFields: ['stopLoss'] }), at);
  assert.equal(mod.title, 'PM 수정승인');
  assert.ok(mod.notes.includes('변경: stopLoss'));
  assert.equal(panelView(decision({ pmDecision: 'REJECT', action: 'NO_TRADE', status: 'NO_TRADE' }), at).title, 'PM 기각 → 거래 없음');
  assert.equal(panelView(decision({ mode: 'scalp', pmDecision: null, finalDecisionMaker: 'ACE' }), at).title, 'ACE 판정 · GUARD 사전 검토');
  const blocked = panelView(decision({ ruleEngine: { verdict: 'DOWNGRADED', violations: [{ code: 'V-DIR-LONG', message: '' }], warnings: [] }, action: 'NO_TRADE' }), at);
  assert.ok(blocked.badges.includes('규칙 차단'));
});

test('P0-2-T1 스캘핑 판정 표기에 PM 문자열이 없다', () => {
  const v = panelView(decision({ mode: 'scalp', pmDecision: null, finalDecisionMaker: 'ACE' }), at);
  assert.equal(JSON.stringify(v).includes('PM'), false);
});

test('P0-3-T4 규칙 위반 결과는 롱(녹색) 색이 아니다', () => {
  const v = panelView(decision({ action: 'NO_TRADE', ruleEngine: { verdict: 'DOWNGRADED', violations: [{ code: 'V-DIR-LONG', message: '' }], warnings: [] } }), at);
  assert.notEqual(v.tone, 'long');
  const f = panelView(decision({ mode: 'forced_direction', forcedDirection: true, unforcedAction: 'NO_TRADE', ruleEngine: { verdict: 'BLOCKED', violations: [{ code: 'V-DIR-LONG', message: '' }], warnings: [] } }), at);
  assert.equal(f.headline, '규칙 위반 — 시뮬레이션 무효');
  assert.notEqual(f.tone, 'long');
});

test('P0-5-T5 unforcedAction=NO_TRADE면 확신도 80이어도 근거 부족 표기가 먼저 나온다', () => {
  const v = panelView(decision({
    mode: 'forced_direction', forcedDirection: true, unforcedAction: 'NO_TRADE', pmDecision: null, finalDecisionMaker: 'ACE',
    confidence: { score: 80, band: 'HIGH', calibrationVersion: 'uncalibrated-v0' },
  }), at);
  assert.equal(v.notes[0], '근거 부족 — 강제로 고른 방향');
  assert.equal(v.tone, 'simulation');
  assert.ok(v.badges.includes('강제 방향 시뮬레이션'));
  assert.equal(v.title, '강제 방향 시뮬레이션 · 판정 아님');
});

test('P0-3-R5 유효 시간이 지나면 만료 배지', () => {
  assert.ok(panelView(decision(), new Date('2026-09-29T03:00:00Z')).badges.includes('만료'));
});

test('기존 표기 변환 규칙 (P0 명세 3.2)', () => {
  assert.deepEqual(legacyToActionBias('BUY', 'spot', 'NEUTRAL'), { action: 'ENTER_LONG', bias: 'BULLISH', reasonCodes: [] });
  assert.deepEqual(legacyToActionBias('SHORT', 'perpetual', 'NEUTRAL'), { action: 'ENTER_SHORT', bias: 'BEARISH', reasonCodes: [] });
  assert.deepEqual(legacyToActionBias('HOLD', 'spot', 'BULLISH'), { action: 'NO_TRADE', bias: 'BULLISH', reasonCodes: ['NO_EDGE'] });
  assert.equal(legacyToActionBias('MAYBE', 'spot', 'NEUTRAL'), null);
});
