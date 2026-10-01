// 작업 엔진 테스트 도구: 역할 입력을 읽어 스키마를 통과하는 출력을 만들고, 역할별로 출력을 바꿔 끼운다.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RoleInput } from '../src/core/data/project.ts';
import { createEngine, type Engine } from '../src/core/job/engine.ts';
import { JobStore } from '../src/core/job/store.ts';
import type { ModelRequest } from '../src/core/model/driver.ts';
import { createScriptedDriver, type ScriptedDriver, type Step } from '../src/core/model/scripted.ts';
import type { ProposalOutput } from '../src/core/schema/proposal.ts';
import type { Role } from '../src/core/schema/types.ts';

export function tempEngine(at: Date): { engine: Engine; store: JobStore; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'floor-jobs-'));
  const store = new JobStore(root);
  return { engine: createEngine({ store, now: () => at }), store, root };
}

/** 재시도 입력에는 오류 요약이 붙으므로 JSON 부분만 읽는다 */
export function parseRequestInput(text: string): RoleInput {
  return JSON.parse(text.split('\n\n[이전 응답 오류]')[0]!) as RoleInput;
}

/** 기준 가격에서 1% 손절, 2%·3% 목표인 롱 제안 (20배 증거금 소진 거리 안). 보유 포지션이 있으면 기존 값 유지 HOLD */
export function sampleProposal(input: RoleInput, over: Partial<ProposalOutput> = {}): ProposalOutput {
  const pb = input.priceBasis!;
  const pos = input.position;
  const px = pb.last!;
  const perp = input.marketType === 'perpetual';
  return {
    instrumentId: input.instrumentId,
    snapshotId: input.snapshotId,
    action: 'ENTER_LONG',
    bias: 'BULLISH',
    unforcedAction: input.mode === 'forced_direction' ? 'ENTER_LONG' : null,
    marketType: input.marketType,
    priceBasis: { sourceRef: pb.sourceRef, currency: pb.currency as ProposalOutput['priceBasis']['currency'] },
    timeframe: input.mode === 'algorithm' ? '1d' : '15m',
    expectedHoldingPeriod: '수 시간',
    validForMinutes: 120,
    entry: { type: 'limit', min: px, max: px },
    stopLoss: px * 0.99,
    targets: [px * 1.02, px * 1.03],
    leverage: perp ? 20 : null,
    confidence: 60,
    rationale: '테스트 제안',
    evidenceRefs: ['derived:rsi14', `snap:${pb.sourceRef}#/last`],
    invalidationConditions: ['손절가 이탈'],
    warnings: [],
    positionRef: null,
    sizeFraction: null,
    scenarios: [],
    tranches: null,
    ...(pos ? { action: 'HOLD', positionRef: pos.positionRef, entry: { type: 'market', min: null, max: null }, stopLoss: null, targets: [], leverage: pos.leverage } : {}),
    ...over,
  };
}

export function sampleOutput(role: Role, input: RoleInput): unknown {
  const text = { summary: `${role} 요약`, narrative: `${role} 브리핑` };
  switch (role) {
    case 'BULL':
      return { steelman: (input.prior?.debate as unknown[] | undefined)?.length ? 'BEAR 요지' : null, evidenceRefs: ['brief:TARO#c1'], openIssues: ['공급 부담'], ...text };
    case 'BEAR':
      return { steelman: 'BULL 요지', evidenceRefs: ['brief:TARO#c1', 'brief:DIANA#c1'], openIssues: ['추세 지속성'], ...text };
    case 'BLITZ':
    case 'ACE':
      return sampleProposal(input);
    case 'PM':
      return { pmDecision: 'APPROVE', modifiedFields: [], reasonCodes: ['RISK_ACCEPTABLE'], revisedProposal: null, ...text };
    default:
      return {
        claims: [
          { claimId: 'c1', kind: 'observation', text: '관찰', evidenceRefs: ['derived:rsi14'] },
          { claimId: 'c2', kind: 'interpretation', text: '해석', evidenceRefs: [] },
        ],
        counterScenario: '반대 시나리오', changeTriggers: [], dataLimitations: [], bias: 'BULLISH', ...text,
      };
  }
}

export type Override = (input: RoleInput, nth: number, req: ModelRequest) => Step | undefined;

/** 역할 입력을 보고 정상 출력을 만드는 드라이버. overrides로 역할별 응답(오류, 지연 포함)을 바꾼다 */
export function autoDriver(overrides: Partial<Record<Role, Override>> = {}): ScriptedDriver {
  const nth: Partial<Record<Role, number>> = {};
  return createScriptedDriver({}, (req) => {
    const i = nth[req.role] ?? 0;
    nth[req.role] = i + 1;
    const input = parseRequestInput(req.input);
    return overrides[req.role]?.(input, i, req) ?? { output: sampleOutput(req.role, input) };
  });
}

/** /floor 경로: CLI 명령마다 작업을 다시 열어 next → submit을 반복한다. finalize는 호출하지 않는다 */
export function floorDrive(engine: Engine, jobId: string, outputFor: (role: Role, input: RoleInput) => unknown = sampleOutput): void {
  for (;;) {
    const n = engine.next(engine.openJob(jobId));
    if (n.kind !== 'steps') return;
    for (const st of n.steps) {
      const r = engine.submit(engine.openJob(jobId), st.stepId, outputFor(st.role, st.input));
      if (!r.ok) throw new Error(`${st.stepId} 제출 실패: ${r.kind === 'schema' ? r.summary : r.message}`);
    }
  }
}
