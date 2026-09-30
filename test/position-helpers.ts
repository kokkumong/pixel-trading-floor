// 포지션 테스트 공용 도구: 가격 100 기준 포지션 컨텍스트, 최소 판정, 실제 포지션 북 경로 (Phase 13·14)
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngine } from '../src/core/job/engine.ts';
import { runJob } from '../src/core/job/runner.ts';
import { JobStore } from '../src/core/job/store.ts';
import { validateBook, type Position } from '../src/core/position/book.ts';
import { derive, type PositionContext } from '../src/core/position/context.ts';
import type { BookRead } from '../src/core/position/store.ts';
import type { applyRules } from '../src/core/rules/engine.ts';
import type { FinalDecision } from '../src/core/schema/decision.ts';
import type { Mode, Role } from '../src/core/schema/types.ts';
import { registry, replayAcquirer } from './data-helpers.ts';
import { JOB, SNAP } from './helpers.ts';
import { autoDriver, type Override } from './job-helpers.ts';

const noSleep = async () => true;

export const POS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';


/** 가격 100 기준 BTC 무기한 롱 보유 (평단 95, 수량 1, 5배, 손절 92). 총 자산 1000 USDT, 한도 1% */
export function held(pos: Partial<Position> = {}, o: { equity?: number | null; risk?: number; none?: boolean } = {}): PositionContext {
  const { note: _n, ...rest } = pos;
  const position: Omit<Position, 'note'> = {
    id: POS, instrumentId: 'CRYPTO:BTC', marketType: 'perpetual', side: 'LONG', avgEntryPrice: 95, quantity: 1, leverage: 5,
    marginMode: 'isolated', liquidationPrice: null, stopLoss: 92, targets: [110], openedAt: null, ...rest,
  };
  const equity = o.equity === undefined ? 1000 : o.equity;
  return {
    schemaVersion: 'position-context/1', builtAt: '2026-09-30T00:00:00Z',
    book: { status: 'ok', updatedAt: '2026-09-30T00:00:00Z', ageHours: 0, positionCount: o.none ? 0 : 1 },
    instrumentId: 'CRYPTO:BTC', marketType: 'perpetual', position: o.none ? null : position,
    account: { currency: 'USDT', equity, riskPerTradePercent: o.risk ?? 1 },
    price: { value: 100, kind: 'mark', sourceRef: 'binance.perp.price' },
    derived: o.none ? null : derive(position, 100, equity), otherMarkets: [], warnings: [], notes: [],
  };
}

/** applyRules 결과로 만든 최소 판정 (화면 표기 검사용) */
export function decisionOf(o: ReturnType<typeof applyRules>, ctx: PositionContext | null, mode: Mode = 'scalp'): FinalDecision {
  return {
    schemaVersion: 'decision/3', jobId: JOB, snapshotId: SNAP, mode, resultClass: mode === 'forced_direction' ? 'simulation' : 'analysis',
    status: o.status, action: o.action, bias: o.bias, unforcedAction: null, proposal: null,
    decidedAt: '2026-09-30T00:00:00Z', validUntil: null, confidence: null, reasonCodes: o.reasonCodes,
    ruleEngine: { verdict: o.verdict, violations: o.violations, warnings: o.warnings }, risk: o.risk,
    finalDecisionMaker: 'ACE', pmDecision: null, modifiedFields: [], forcedDirection: mode === 'forced_direction', executionBackend: 'subprocess_per_role',
    positionRef: ctx?.position?.id ?? null, positionPlan: o.positionPlan, sizing: o.sizing,
  };
}


export const SECRET = { quantity: 0.123456, equity: 98765.43, note: '비밀메모-XYZ' };

export function bookRead(marketType: 'spot' | 'perpetual', over: Record<string, unknown> = {}): BookRead {
  const r = validateBook({
    schemaVersion: 'positions/1', updatedAt: '2026-09-29T00:00:00Z',
    account: { equity: { USDT: SECRET.equity, USD: SECRET.equity }, riskPerTradePercent: 1 },
    positions: [{
      id: POS, instrumentId: 'CRYPTO:BTC', marketType, side: 'LONG', avgEntryPrice: 80000, quantity: SECRET.quantity,
      leverage: marketType === 'perpetual' ? 10 : null, marginMode: marketType === 'perpetual' ? 'isolated' : null,
      liquidationPrice: null, stopLoss: 78000, targets: [90000], openedAt: '2026-09-28T00:00:00Z', note: SECRET.note, ...over,
    }],
  }, (id) => registry.get(id) !== undefined);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  return { status: 'ok', book: r.book };
}

/** book을 주지 않으면 작업 시장과 같은 시장의 롱 보유 (algorithm은 현물, 그 외 무기한) */
export async function runWithBook(mode: Mode, overrides: Partial<Record<Role, Override>> = {}, fail: string[] = [], book?: BookRead) {
  const r = replayAcquirer(mode === 'algorithm' ? 'btc-algorithm' : 'btc-scalp', { fail });
  const root = mkdtempSync(join(tmpdir(), 'floor-p13-'));
  const store = new JobStore(root);
  const engine = createEngine({ store, now: () => r.at, positions: () => book ?? bookRead(mode === 'algorithm' ? 'spot' : 'perpetual') });
  const job = await engine.createJob({ idempotencyKey: `k-${Math.random()}`, mode, symbolInput: r.symbol, interface: 'web' }, r.acquirer);
  const driver = autoDriver(overrides);
  if (job.record.state !== 'INSUFFICIENT_DATA') await runJob(engine, job, driver, new AbortController().signal, { sleep: noSleep });
  return { engine, job, store, root, driver, rec: job.record, d: job.record.finalDecision, requests: r.net.requests };
}
