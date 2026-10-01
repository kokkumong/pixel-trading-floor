// P2 포지션 명세 2~4장: 행동 집합 확장, 포지션 규칙, 수량 제안, 역할별 포지션 입력 (Phase 13)
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { judgeToolUse } from '../../scripts/floor-guard.ts';
import type { RoleInput } from '../../src/core/data/project.ts';
import { createEngine } from '../../src/core/job/engine.ts';
import { runJob } from '../../src/core/job/runner.ts';
import { JobStore } from '../../src/core/job/store.ts';
import { validateBook, type Position } from '../../src/core/position/book.ts';
import { derive, type PositionContext } from '../../src/core/position/context.ts';
import type { BookRead } from '../../src/core/position/store.ts';
import { panelView } from '../../src/core/rules/display.ts';
import { applyRules } from '../../src/core/rules/engine.ts';
import type { FinalDecision } from '../../src/core/schema/decision.ts';
import { checkProposal, type ProposalOutput } from '../../src/core/schema/proposal.ts';
import type { Mode, Role } from '../../src/core/schema/types.ts';
import { registry, replayAcquirer } from '../data-helpers.ts';
import { JOB, proposal, proposalCtx, proposalOutput, ruleCtx, SNAP } from '../helpers.ts';
import { autoDriver, floorDrive, sampleProposal, type Override } from '../job-helpers.ts';
import { bookRead, decisionOf, held, POS, runWithBook, SECRET } from '../position-helpers.ts';

const codes = (r: ReturnType<typeof checkProposal>) => (r.ok ? [] : r.errors.map((e) => e.code));
const vcodes = (o: { violations: { code: string }[] }) => o.violations.map((v) => v.code);
const noSleep = async () => true;
const keep = { entry: { type: 'market' as const, min: null, max: null }, stopLoss: null, targets: [], leverage: 5 };
const hold = (over: Partial<ProposalOutput> = {}) => proposal({ action: 'HOLD', positionRef: POS, ...keep, ...over });
const add = (over: Partial<ProposalOutput> = {}) => proposal({ action: 'ADD', positionRef: POS, ...keep, entry: { type: 'limit', min: 100, max: 100 }, ...over });
const rules = (p: ReturnType<typeof proposal>, ctx: PositionContext | null, over: Parameters<typeof ruleCtx>[1] = {}) =>
  applyRules(p, ruleCtx('scalp', { positionContext: ctx, ...over }));

// ── P2-2 행동 집합 ──

test('P2-2-T1 포지션 유무와 행동이 맞지 않으면 V-POS-STATE 스키마 오류', () => {
  const withPos = proposalCtx('scalp', { positionId: POS });
  assert.deepEqual(codes(checkProposal(proposalOutput({ positionRef: POS }), withPos)), ['V-POS-STATE']); // 보유 + ENTER_LONG
  assert.deepEqual(codes(checkProposal(proposalOutput({ action: 'NO_TRADE', positionRef: POS }), withPos)), ['V-POS-STATE']);
  assert.deepEqual(codes(checkProposal(proposalOutput({ action: 'EXIT', bias: 'BEARISH' }), proposalCtx())), ['V-POS-STATE']); // 없음 + EXIT
  assert.deepEqual(codes(checkProposal(proposalOutput({ action: 'HOLD', positionRef: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }), withPos)), ['V-POS-STATE']);
  assert.deepEqual(codes(checkProposal(proposalOutput({ action: 'HOLD', positionRef: null }), withPos)), ['V-POS-STATE']);
  assert.deepEqual(codes(checkProposal(proposalOutput({ action: 'REDUCE', positionRef: POS }), withPos)), ['V-POS-STATE']); // 비율 없음
  assert.deepEqual(codes(checkProposal(proposalOutput({ action: 'REDUCE', positionRef: POS, sizeFraction: 0.3 }), withPos)), ['V-POS-STATE']);
  assert.deepEqual(codes(checkProposal(proposalOutput({ action: 'HOLD', positionRef: POS, sizeFraction: 0.5 }), withPos)), ['V-POS-STATE']);
  assert.deepEqual(codes(checkProposal(proposalOutput({ positionRef: POS }), proposalCtx())), ['V-POS-STATE']); // 없음인데 참조
  const ok = checkProposal(proposalOutput({ action: 'REDUCE', positionRef: POS, sizeFraction: 0.5 }), withPos);
  assert.ok(ok.ok);
  assert.equal(ok.proposal.schemaVersion, 'proposal/4');
  // 강제 방향은 포지션 행동을 쓰지 않는다
  assert.deepEqual(codes(checkProposal(proposalOutput({ action: 'HOLD', unforcedAction: 'NO_TRADE' }), proposalCtx('forced_direction'))), ['V-ACTION', 'V-POS-STATE']);
});

test('P2-2-T1 엔진: 보유 중 ENTER_LONG 응답은 재시도되고, 다시 맞게 답하면 완료된다', async () => {
  const { rec, d } = await runWithBook('scalp', {
    ACE: (input, nth) => (nth === 0 ? { output: sampleProposal(input, { action: 'ENTER_LONG', positionRef: null }) } : undefined),
  });
  assert.equal(rec.state, 'COMPLETED');
  assert.equal(rec.usage.retryCallCount, 1);
  assert.equal(d?.action, 'HOLD');
});

test('P2-2-T2 롱 보유 + EXIT + BEARISH는 그대로 저장되고 전량 청산 검토로 표시된다', async () => {
  const o = rules(proposal({ action: 'EXIT', bias: 'BEARISH', positionRef: POS, ...keep, stopLoss: 50, targets: [1] }), held());
  assert.deepEqual([o.verdict, o.status, o.action, o.bias], ['PASS', 'VALID', 'EXIT', 'BEARISH']);
  // V-EXIT-CONSISTENCY: 청산 제안의 손절·목표는 무시하고 경고도 없다
  assert.deepEqual([o.positionPlan?.stopLoss, o.positionPlan?.targets, o.warnings], [92, [110], []]);
  const v = panelView(decisionOf(o, held()));
  assert.equal(v.headline, '전량 청산 검토');
  assert.notEqual(v.tone, 'long');
  assert.ok(v.notes.some((n) => n.includes('청산 후 새로 분석')), v.notes.join('|')); // P2-2-R2 리버설 안내

  const r = panelView(decisionOf(rules(proposal({ action: 'REDUCE', sizeFraction: 0.25, positionRef: POS, ...keep }), held()), held()));
  assert.equal(r.headline, '일부 청산 검토 (25%)');
  assert.notEqual(r.tone, 'long');
  assert.equal(panelView(decisionOf(rules(hold(), held()), held())).headline, '유지');

  // 반대 방향 진입(리버설)은 V-POS-STATE로 걸러진다
  const withPos = proposalCtx('scalp', { positionId: POS });
  assert.deepEqual(codes(checkProposal(proposalOutput({ action: 'ENTER_SHORT', bias: 'BEARISH', positionRef: POS }), withPos)), ['V-POS-STATE']);

  const { rec, d } = await runWithBook('scalp', {
    ACE: (input) => ({ output: sampleProposal(input, { action: 'EXIT', bias: 'BEARISH', entry: { type: 'market', min: null, max: null }, stopLoss: null, targets: [] }) }),
  });
  assert.equal(rec.state, 'COMPLETED');
  assert.deepEqual([d?.schemaVersion, d?.status, d?.action, d?.bias, d?.positionRef], ['decision/4', 'VALID', 'EXIT', 'BEARISH', POS]);
  assert.equal(d?.proposal?.schemaVersion, 'proposal/4');
  assert.equal(panelView(d!).headline, '전량 청산 검토');
});

test('P2-2-T3 강제 방향은 포지션이 있어도 컨텍스트를 만들지 않고 포지션 무시 시뮬레이션으로 표시된다', async () => {
  const { rec, d, driver } = await runWithBook('forced_direction');
  assert.equal(rec.state, 'COMPLETED');
  assert.equal(rec.positionContext, null);
  assert.equal(d?.positionRef, null);
  assert.ok(panelView(d!).notes.includes('포지션 무시 시뮬레이션'));
  for (const c of driver.calls) assert.equal((JSON.parse(c.input) as RoleInput).position, undefined, c.role);
});

test('P2-2-R7 PM 기각은 포지션이 있으면 HOLD', async () => {
  const { d } = await runWithBook('algorithm', {
    PM: () => ({ output: { pmDecision: 'REJECT', modifiedFields: [], reasonCodes: ['RISK_TOO_HIGH'], revisedProposal: null, summary: 'PM', narrative: 'PM' } }),
  });
  assert.deepEqual([d?.status, d?.action, d?.proposal, d?.pmDecision], ['VALID', 'HOLD', null, 'REJECT']);
  assert.ok(d?.reasonCodes.includes('PM_REJECTED'));
});

// ── P2-3 규칙과 수량 제안 ──

test('P2-3-T1 롱 손절을 기존보다 아래로 넓히는 HOLD는 기존 손절을 유지한다', () => {
  const o = rules(hold({ stopLoss: 85 }), held());
  assert.deepEqual([o.verdict, o.action, o.positionPlan?.stopLoss, o.positionPlan?.stopUpdated], ['PASS', 'HOLD', 92, false]);
  assert.ok(o.warnings.some((w) => w.startsWith('V-STOP-WIDEN')));
  assert.ok(o.reasonCodes.includes('STOP_WIDEN_IGNORED'));
  // 좁히는 갱신은 적용된다
  const t = rules(hold({ stopLoss: 94, targets: [108] }), held());
  assert.deepEqual([t.positionPlan?.stopLoss, t.positionPlan?.targets, t.positionPlan?.stopUpdated], [94, [108], true]);
  // 숏은 반대: 기존 110보다 위로 올리면 넓히기
  const s = rules(hold({ stopLoss: 115, bias: 'BEARISH' }), held({ side: 'SHORT', avgEntryPrice: 105, stopLoss: 110, targets: [90] }));
  assert.equal(s.positionPlan?.stopLoss, 110);
});

test('P2-3-T2 현재가가 이미 손절을 넘었으면 HOLD + STOP_ALREADY_HIT 강한 경고, 정상 색 아님', () => {
  const ctx = held({ stopLoss: 101 }); // 롱 손절 101 > 현재가 100
  const o = rules(hold(), ctx);
  assert.deepEqual([o.verdict, o.action, o.bias], ['DOWNGRADED', 'HOLD', 'BULLISH']);
  assert.ok(vcodes(o).includes('V-POS-STOP-DIR'));
  assert.ok(o.reasonCodes.includes('STOP_ALREADY_HIT'));
  const v = panelView(decisionOf(o, ctx));
  assert.notEqual(v.tone, 'long');
  assert.ok(v.notes[0]?.includes('손절 이미 도달'), v.notes.join('|'));
  assert.ok(v.notes.some((n) => n.includes('규칙에 의해 모델 제안이 조정됨') && n.includes('V-POS-STOP-DIR'))); // P2-3-R2
  // ADD도 HOLD로 강등, 모델 제안의 손절 갱신은 버린다
  const a = rules(add({ stopLoss: 99.5 }), ctx);
  assert.deepEqual([a.action, a.positionPlan?.stopLoss, a.sizing], ['HOLD', 101, null]);
});

test('P2-3-T3 청산가가 현재가에서 2×ATR 안이면 ADD는 HOLD로 강등되고 청산가 근접이 표시된다', () => {
  const ctx = held({ liquidationPrice: 99, stopLoss: 99.6 }); // 거리 1 < 2 × 0.8
  const o = rules(add({ stopLoss: null }), ctx);
  assert.deepEqual([o.verdict, o.action], ['DOWNGRADED', 'HOLD']);
  assert.ok(vcodes(o).includes('V-POS-LIQ-NEAR'));
  assert.ok(o.reasonCodes.includes('LIQUIDATION_NEAR'));
  const v = panelView(decisionOf(o, ctx));
  assert.ok(v.notes.some((n) => n.includes('청산가 근접')));
  assert.notEqual(v.tone, 'long');
  // HOLD는 모델 판단을 따르고 경고만
  const h = rules(hold(), ctx);
  assert.deepEqual([h.action, h.verdict], ['HOLD', 'PASS']);
  assert.ok(h.reasonCodes.includes('LIQUIDATION_NEAR'));
  // V-POS-LIQ-BUFFER: 손절 거리(8%)가 청산 거리(10%)의 절반을 넘으면 ADD 차단, HOLD 경고
  const far = held({ liquidationPrice: 90 });
  assert.ok(vcodes(rules(add(), far)).includes('V-POS-LIQ-BUFFER'));
  const hb = rules(hold(), far);
  assert.deepEqual([hb.verdict, vcodes(hb)], ['PASS', []]);
  assert.ok(hb.warnings.some((w) => w.startsWith('V-POS-LIQ-BUFFER')));
});

test('P2-3-T4 총 자산 1000 USDT·한도 1%·진입 100·손절 95 → 제안 수량 2, 열린 리스크가 예산을 채우면 RISK_BUDGET_FULL', () => {
  const flat = held({}, { none: true });
  const e = rules(proposal({ stopLoss: 95, leverage: 2 }), flat);
  assert.deepEqual([e.verdict, e.action], ['PASS', 'ENTER_LONG']);
  assert.equal(e.sizing?.suggestedQuantity, 2);
  assert.deepEqual([e.sizing?.riskBudget, e.sizing?.entryPrice, e.sizing?.stopLoss], [10, 100, 95]);
  const v = panelView(decisionOf(e, flat));
  assert.ok(v.notes.some((n) => n.includes('제안 수량 2') && n.includes('총 자산 대비 손실 한도 1% 기준') && n.includes('참고용')), v.notes.join('|'));
  // 강등되면 수량 제안도 없다
  assert.equal(rules(proposal({ stopLoss: 95, leverage: 2, bias: 'BEARISH' }), flat).sizing, null);
  // 총 자산이 없으면 수량 제안 없음
  assert.equal(rules(proposal({ stopLoss: 95, leverage: 2 }), held({}, { none: true, equity: null })).sizing, null);
  // P2-3-R6 필요 증거금이 총 자산의 50%를 넘으면 MARGIN_HEAVY
  const heavy = rules(proposal({ stopLoss: 99, leverage: 2 }), held({}, { none: true, risk: 5 }));
  assert.equal(heavy.sizing?.suggestedQuantity, 50);
  assert.ok(heavy.reasonCodes.includes('MARGIN_HEAVY'));

  // ADD: 예산 10 − 기존 리스크 3 (평단 95 − 손절 92) = 7 → 7 ÷ 8 = 0.875
  const a = rules(add(), held());
  assert.deepEqual([a.action, a.sizing?.existingRisk, a.sizing?.addableRisk, a.sizing?.suggestedQuantity], ['ADD', 3, 7, 0.875]);
  // 기존 리스크 15 (평단 100 − 손절 97, 수량 5) ≥ 예산 10
  const full = rules(add(), held({ avgEntryPrice: 100, quantity: 5, stopLoss: 97 }));
  assert.deepEqual([full.verdict, full.action, full.sizing], ['DOWNGRADED', 'HOLD', null]);
  assert.ok(vcodes(full).includes('V-RISK-BUDGET'));
  assert.ok(full.reasonCodes.includes('RISK_BUDGET_FULL'));
});

test('P2-3-T5 기존 포지션에 손절이 없으면 ADD 수량 제안이 없고 NO_STOP_ON_POSITION 경고', () => {
  const ctx = held({ stopLoss: null });
  const o = rules(add({ stopLoss: 92 }), ctx);
  assert.deepEqual([o.verdict, o.action, o.sizing], ['PASS', 'ADD', null]);
  assert.ok(o.reasonCodes.includes('NO_STOP_ON_POSITION'));
  assert.ok(panelView(decisionOf(o, ctx)).notes.some((n) => n.includes('손절이 없어')));
  // HOLD·EXIT에는 영향 없음
  assert.ok(!rules(hold({ stopLoss: 92 }), ctx).reasonCodes.includes('NO_STOP_ON_POSITION'));
  // 기존 손절도 새 손절도 없으면 ADD 불가
  assert.ok(vcodes(rules(add(), ctx)).includes('V-STOP-REQUIRED'));
});

test('P2-3-T6 INSUFFICIENT_DATA면 포지션이 있어도 모델 호출이 없고 HOLD 등으로 표시되지 않는다', async () => {
  const { rec, d, driver } = await runWithBook('scalp', {}, ['fapi.binance.com/fapi/v1/premiumIndex', 'fapi.binance.com/fapi/v1/ticker']);
  assert.equal(rec.state, 'INSUFFICIENT_DATA');
  assert.equal(driver.calls.length, 0);
  assert.deepEqual([d?.status, d?.action, d?.positionRef], ['INSUFFICIENT_DATA', null, POS]);
  const v = panelView(d!);
  assert.equal(v.headline, '데이터 부족');
  assert.ok(v.notes.includes('포지션은 그대로이며 판정이 없음'));
});

// ── P2-4 모델 입력 ──

const DECIDERS: Record<'scalp' | 'algorithm', Role[]> = { scalp: ['BLITZ', 'GUARD', 'ACE'], algorithm: ['ACE', 'RISKY', 'SAFE', 'NEUTRAL', 'PM'] };
const BLIND: Record<'scalp' | 'algorithm', Role[]> = { scalp: ['TARO', 'VIBE'], algorithm: ['TARO', 'DIANA', 'NOVA', 'VIBE', 'BULL', 'BEAR'] };

test('P2-4-T1 분석가 4명·BULL·BEAR 프롬프트에는 포지션 정보가 없다', async () => {
  for (const mode of ['scalp', 'algorithm'] as const) {
    const { driver, rec } = await runWithBook(mode);
    assert.equal(rec.state, 'COMPLETED', mode);
    const seen = new Set<Role>();
    for (const c of driver.calls.filter((x) => BLIND[mode].includes(x.role))) {
      seen.add(c.role);
      assert.equal((JSON.parse(c.input) as RoleInput).position, undefined, c.role);
      for (const text of [c.input, c.systemPrompt]) {
        assert.ok(!text.includes(POS) && !text.includes('positionRef') && !text.includes('보유 포지션'), `${mode} ${c.role}`);
      }
    }
    assert.deepEqual([...seen].sort(), [...BLIND[mode]].sort());
  }
});

test('P2-4-T2 결정 역할 입력에는 비율 필드만 있고 금액·수량·총 자산·메모는 없다', async () => {
  for (const mode of ['scalp', 'algorithm'] as const) {
    const { driver } = await runWithBook(mode);
    const seen = new Set<Role>();
    for (const c of driver.calls.filter((x) => DECIDERS[mode].includes(x.role))) {
      seen.add(c.role);
      const pos = (JSON.parse(c.input) as RoleInput).position;
      assert.ok(pos, `${mode} ${c.role}`);
      assert.deepEqual(Object.keys(pos).sort(), [
        'avgEntryPrice', 'bookAgeHours', 'holdingHours', 'leverage', 'liquidationDistancePercent', 'marginMode', 'marketType',
        'positionRef', 'positionWeightPercent', 'rMultiple', 'side', 'stopDistancePercent', 'stopLoss', 'targets',
        'unrealizedPnlPercent', 'unrealizedPnlPercentLeveraged',
      ]);
      assert.equal(pos.positionRef, POS);
      assert.ok(c.systemPrompt.includes('보유 포지션'), c.role); // 포지션 지침 (P2-4-R3)
      for (const text of [c.input, c.systemPrompt]) {
        for (const secret of [String(SECRET.quantity), String(SECRET.equity), SECRET.note, 'quantity', 'equity']) {
          assert.ok(!text.includes(secret), `${mode} ${c.role}: ${secret}`);
        }
      }
    }
    assert.deepEqual([...seen].sort(), [...DECIDERS[mode]].sort());
  }
});

test('P2-4-T3 HOLD도 근거 참조와 무효화 조건이 필요하다', () => {
  const few = rules(hold({ evidenceRefs: ['derived:rsi14'] }), held());
  assert.equal(few.verdict, 'DOWNGRADED');
  assert.ok(vcodes(few).includes('V-EVIDENCE-REF'));
  const none = rules(hold({ invalidationConditions: [] }), held());
  assert.equal(none.verdict, 'DOWNGRADED');
  assert.ok(vcodes(none).includes('V-HOLD-INVALIDATION'));
  assert.equal(rules(hold(), held()).verdict, 'PASS');
});

test('P2-4-T4 /floor 세션은 .floor/를 읽지 못하고 코어 next 출력에 투영된 포지션이 있다', async () => {
  const ROOT = join('/', 'home', 'u', 'floor');
  const judge = (tool_name: string, tool_input: Record<string, unknown>) => judgeToolUse({ tool_name, tool_input, cwd: ROOT }, ROOT);
  for (const p of [join(ROOT, '.floor', 'positions.json'), '.floor/positions.json', join(ROOT, '.floor', 'positions.json.bak')]) {
    assert.equal(judge('Read', { file_path: p }).allow, false, p);
  }
  assert.equal(judge('Bash', { command: 'cat .floor/positions.json' }).allow, false);

  const r = replayAcquirer('btc-scalp');
  const root = mkdtempSync(join(tmpdir(), 'floor-p13-'));
  const engine = createEngine({ store: new JobStore(root), now: () => r.at, positions: () => bookRead('perpetual') });
  const job = await engine.createJob({ idempotencyKey: 'k-floor', mode: 'scalp', symbolInput: r.symbol, interface: 'floor' }, r.acquirer);
  floorDrive(engine, job.record.jobId);
  const ace = JSON.parse(readFileSync(join(root, job.record.jobId, 'inputs', 'ACE.json'), 'utf8')) as RoleInput;
  assert.equal(ace.position?.positionRef, POS);
  const taro = JSON.parse(readFileSync(join(root, job.record.jobId, 'inputs', 'TARO.json'), 'utf8')) as RoleInput;
  assert.equal(taro.position, undefined);
  const text = readFileSync(join(root, job.record.jobId, 'inputs', 'ACE.json'), 'utf8');
  assert.ok(!text.includes(String(SECRET.quantity)) && !text.includes(SECRET.note));
});
