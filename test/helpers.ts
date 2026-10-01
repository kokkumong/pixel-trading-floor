import { createEvidenceIndex, type EvidenceIndex } from '../src/core/rules/evidence.ts';
import type { RuleContext } from '../src/core/rules/engine.ts';
import type { ProposalContext, ProposalOutput, TradeProposal } from '../src/core/schema/proposal.ts';
import type { Mode } from '../src/core/schema/types.ts';

export const JOB = '11111111-1111-4111-8111-111111111111';
export const SNAP = '22222222-2222-4222-8222-222222222222';

/** 스키마를 통과하는 기본 롱 제안 (BTC 무기한, 지정가 100, 손절 98, 목표 104·106) */
export function proposalOutput(over: Partial<ProposalOutput> = {}): ProposalOutput {
  return {
    instrumentId: 'CRYPTO:BTC',
    snapshotId: SNAP,
    action: 'ENTER_LONG',
    bias: 'BULLISH',
    unforcedAction: null,
    marketType: 'perpetual',
    priceBasis: { sourceRef: 'binance.perp.price', currency: 'USDT' },
    timeframe: '15m',
    expectedHoldingPeriod: '2~6시간',
    validForMinutes: 120,
    entry: { type: 'limit', min: 100, max: 100 },
    stopLoss: 98,
    targets: [104, 106],
    leverage: 20,
    confidence: 62,
    rationale: '20EMA 지지 확인 후 반등',
    evidenceRefs: ['derived:rsi14', 'snap:binance.perp.price#/last'],
    invalidationConditions: ['15분봉 종가 98 이탈'],
    warnings: [],
    positionRef: null,
    sizeFraction: null,
    scenarios: [],
    tranches: null,
    ...over,
  };
}

export function proposal(over: Partial<ProposalOutput> = {}, author: TradeProposal['author'] = 'ACE'): TradeProposal {
  return { schemaVersion: 'proposal/4', jobId: JOB, author, ...proposalOutput(over) };
}

export function proposalCtx(mode: Mode = 'scalp', over: Partial<ProposalContext> = {}): ProposalContext {
  return { mode, jobId: JOB, snapshotId: SNAP, instrumentId: 'CRYPTO:BTC', marketType: 'perpetual', author: 'ACE', positionId: null, ...over };
}

export const evidence: EvidenceIndex = createEvidenceIndex({
  snapshot: {
    'binance.perp.price': { last: 100, mark: 100.1 },
    'binance.perp.funding': { rate: 0.0001 },
    'yahoo.spot.price': { last: 1_341_000 },
  },
  derived: { rsi14: 55, atr14: 1.2, macd: { hist: 0.3 }, ma50: null },
  briefs: { TARO: ['c1', 'c2'] },
});

export function ruleCtx(mode: Mode = 'scalp', over: Partial<RuleContext> = {}): RuleContext {
  return {
    mode,
    dataQuality: 'OK',
    sources: {
      'binance.perp.price': { estimated: false, price: 100 },
      'yahoo.spot.price': { estimated: false, price: 1_341_000 },
      'tapbit.perp.estimate': { estimated: true, price: 100.2 },
    },
    riskPrice: { value: 100, kind: 'mark' },
    atr14: 0.8,
    evidence,
    ...over,
  };
}
