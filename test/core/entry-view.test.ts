// P3 신규 진입 명세 2·5·6장: 관망 후속 안내, PM 수정, 시나리오 카드·리포트 표시 (Phase 18)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { maskDecision, MASK } from '../../src/core/position/mask.ts';
import { DISCLAIMER, panelView } from '../../src/core/rules/display.ts';
import { applyRules } from '../../src/core/rules/engine.ts';
import {
  entryPlanView, minutesLabel, NO_EQUITY_NOTE, NO_WAIT_PLAN_NOTE, NO_WATCH_NOTE, SCENARIO_EXPIRED, SCENARIO_HEADING, SCENARIO_NOTICE, TRANCHE_RULE_NOTE,
} from '../../src/core/rules/entryview.ts';
import { renderMarkdown } from '../../src/core/report/markdown.ts';
import { buildReport } from '../../src/core/report/report.ts';
import type { FinalDecision } from '../../src/core/schema/decision.ts';
import type { ProposalOutput, Scenario } from '../../src/core/schema/proposal.ts';
import { jobView, maskJobView } from '../../src/server/view.ts';
import { proposal, ruleCtx } from '../helpers.ts';
import { sampleProposal, sampleScenario, type Override } from '../job-helpers.ts';
import { bookRead, decisionOf, held, runWithBook } from '../position-helpers.ts';

/** 단정 표현 (P2-6-R6, P3-6-R5) */
const ASSERTIVE = /반드시 (오른|내린|상승|하락|수익)|지금 (사라|사세요|매수하라|진입하라)|확실(히|한) (수익|상승)|무조건/;
const noTradeFields: Partial<ProposalOutput> = { action: 'NO_TRADE', bias: 'BULLISH', entry: { type: 'market', min: null, max: null }, stopLoss: null, targets: [], leverage: null };

/** 알고리즘(현물) 작업 · 무기한만 보유 → 보유 없는 신규 진입 분석, 총 자산 있음 */
const runFlat = (ace: Override, pm?: Override) => runWithBook('algorithm', { ACE: ace, ...(pm ? { PM: pm } : {}) }, [], bookRead('perpetual'));
const reportOf = (out: Awaited<ReturnType<typeof runWithBook>>) =>
  buildReport(out.job, { claudeCliVersion: '2.1.284 (Claude Code)' }, new Date(Date.parse(out.rec.createdAt) + 60_000));

test('P3-2-T1 NO_TRADE에 PRIMARY 시나리오가 없으면 NO_WAIT_PLAN 경고가 화면·리포트에 표시되고 재시도·차단은 없다', async () => {
  const out = await runFlat((input) => ({ output: sampleProposal(input, { ...noTradeFields, scenarios: [] }) }));
  const d = out.d!;
  assert.deepEqual([out.rec.state, d.action, d.ruleEngine.verdict, out.rec.usage.retryCallCount], ['COMPLETED', 'NO_TRADE', 'PASS', 0]);
  assert.deepEqual(d.entryPlan?.warnings, ['NO_WAIT_PLAN']);
  const v = panelView(d, new Date(d.decidedAt), out.rec.positionContext ?? null);
  assert.equal(v.headline, '거래 없음 · 강세 전망'); // P3-2-R3: 표기는 P0 3.2 그대로
  assert.deepEqual(v.entryPlan?.warnings, [NO_WAIT_PLAN_NOTE]);
  assert.deepEqual(v.entryPlan?.cards, []);
  const md = renderMarkdown(reportOf(out));
  assert.ok(md.includes(`## ${SCENARIO_HEADING}`) && md.includes(NO_WAIT_PLAN_NOTE));
});

test('P3-2-T1 NO_TRADE + PRIMARY 시나리오: 카드에 조건 미충족 문구·재확인 시점·손익비·수량이 있고 경고가 없다', async () => {
  const out = await runFlat((input) => ({ output: sampleProposal(input, { ...noTradeFields, scenarios: [sampleScenario(input)] }) }));
  const d = out.d!;
  assert.deepEqual([d.action, d.entryPlan?.warnings, d.entryPlan?.scenarios.length], ['NO_TRADE', [], 1]);
  const e = panelView(d, new Date(d.decidedAt)).entryPlan!;
  assert.deepEqual([e.heading, e.notice, e.expiredNotice, e.guide, e.validUntil], [SCENARIO_HEADING, SCENARIO_NOTICE, SCENARIO_EXPIRED, NO_WATCH_NOTE, d.validUntil]);
  const c = e.cards[0]!;
  assert.equal(c.title, '롱 · 눌림 · 주 시나리오');
  assert.equal(c.recheck, '재확인 1시간 뒤');
  assert.match(c.condition, /^조건 \(4h\): 가격이 [\d.]+까지 내려옴 — 종가가 기준 가격 위에서 마감$/);
  assert.deepEqual(c.fields.map((f) => f.label), ['진입 구간', '손절', '목표', '손익비', '수량']);
  assert.match(c.fields.at(-1)!.value, /^[\d.]+ \(.+\)$/);
  assert.deepEqual(c.warnings, []);
  assert.equal(out.rec.evidenceAudit?.length ?? 0, 0);
});

test('P3-2-T2 V-DIR-LONG으로 강등된 NO_TRADE는 시나리오를 재검사해 통과한 것만 보여 주고 조정 문구를 함께 표시한다', async () => {
  const out = await runFlat((input) => {
    const px = input.priceBasis!.last!;
    const bad = sampleScenario(input, { role: 'ALTERNATE', stopLoss: px * 1.01 }); // 롱인데 손절이 진입 위 → V-SCN-DIR
    return { output: sampleProposal(input, { stopLoss: px * 1.01, scenarios: [sampleScenario(input), bad] }) };
  });
  const d = out.d!;
  assert.deepEqual([out.rec.state, d.action, d.ruleEngine.verdict], ['COMPLETED', 'NO_TRADE', 'DOWNGRADED']);
  assert.ok(d.ruleEngine.violations.some((x) => x.code === 'V-DIR-LONG'));
  assert.deepEqual([d.entryPlan?.scenarios.length, d.entryPlan?.dropped.map((x) => x.codes)], [1, [['V-SCN-DIR']]]);
  const v = panelView(d, new Date(d.decidedAt));
  assert.ok(v.notes.some((n) => n.startsWith('규칙에 의해 모델 제안이 조정됨: ') && n.includes('V-DIR-LONG')));
  assert.equal(v.entryPlan?.cards.length, 1);
  assert.deepEqual(v.entryPlan?.warnings, ['규칙 검사에서 제외된 시나리오 1건 (V-SCN-DIR)']); // P3-4-T2: 개수 표시
  assert.notEqual(v.tone, 'long');
});

test('P3-2-T3 · P3-1-T2 INSUFFICIENT_DATA·보유·강제 방향 결과에는 시나리오 영역이 없고 HOLD·관망 안전 류 문구가 없다', async () => {
  const none = await runWithBook('scalp', {}, ['fapi.binance.com/fapi/v1/premiumIndex', 'fapi.binance.com/fapi/v1/ticker'], bookRead('spot'));
  assert.deepEqual([none.rec.state, none.d?.entryPlan ?? null, none.driver.calls.length], ['INSUFFICIENT_DATA', null, 0]);
  const view = jobView(none.rec, new Date(none.rec.createdAt));
  assert.equal(view.panel, null);
  assert.equal(panelView(none.d!).entryPlan, null);
  for (const word of ['HOLD', '관망', '안전', SCENARIO_HEADING, SCENARIO_NOTICE]) assert.ok(!JSON.stringify(view).includes(word), word);

  // 보유 분석: 모델이 시나리오를 써도 쓰지 않는다
  const heldRun = await runWithBook('scalp', { ACE: (input) => ({ output: { ...sampleProposal(input), scenarios: [sampleScenario(input)] } }) });
  assert.deepEqual([heldRun.d?.action, heldRun.d?.entryPlan], ['HOLD', null]);
  assert.equal(panelView(heldRun.d!, new Date(), heldRun.rec.positionContext).entryPlan, null);
  const forced = await runWithBook('forced_direction', { ACE: (input) => ({ output: { ...sampleProposal(input), scenarios: [sampleScenario(input)] } }) });
  assert.deepEqual([forced.rec.state, forced.d?.entryPlan], ['COMPLETED', null]);
  assert.equal(panelView(forced.d!).entryPlan, null);
});

test('P3-5-T3 PM이 scenarios를 수정하면 modifiedFields에 기록되고 최종 entryPlan은 PM 수정안을 따른다', async () => {
  const out = await runFlat(
    (input) => ({ output: sampleProposal(input, { scenarios: [sampleScenario(input, { role: 'ALTERNATE', entry: { type: 'zone', min: input.priceBasis!.last! * 0.98, max: input.priceBasis!.last! * 0.985 }, trigger: { kind: 'PULLBACK', level: input.priceBasis!.last! * 0.982, timeframe: '4h', confirmation: '확인' }, stopLoss: input.priceBasis!.last! * 0.97 })] }) }),
    (input) => ({
      output: {
        pmDecision: 'MODIFY', modifiedFields: [], reasonCodes: ['WEAK_EVIDENCE'], summary: 'PM 요약', narrative: 'PM 브리핑',
        revisedProposal: { ...(input.prior!.proposal as Record<string, unknown>), scenarios: [] },
      },
    }),
  );
  const d = out.d!;
  assert.deepEqual([out.rec.state, d.pmDecision, d.modifiedFields], ['COMPLETED', 'MODIFY', ['scenarios']]);
  assert.deepEqual(d.proposal?.scenarios, []);
  assert.deepEqual(d.entryPlan?.scenarios, []);
  assert.ok(panelView(d, new Date(d.decidedAt)).notes.includes('변경: scenarios'));
});

test('P3-5-T1 시나리오가 있어도 호출 수 계획과 실제 호출 수가 P0 8.3과 같다', async () => {
  const withScn: Override = (input) => ({ output: sampleProposal(input, { ...noTradeFields, scenarios: [sampleScenario(input)] }) });
  const algo = await runFlat(withScn);
  assert.deepEqual(algo.rec.plannedModelCallRange, { min: 11, max: 13 });
  assert.ok(algo.rec.usage.modelCallCount >= 11 && algo.rec.usage.modelCallCount <= 13);
  const scalp = await runWithBook('scalp', { BLITZ: withScn, ACE: withScn }, [], bookRead('spot'));
  assert.deepEqual([scalp.rec.plannedModelCallRange, scalp.rec.usage.modelCallCount, scalp.d?.entryPlan?.scenarios.length], [{ min: 5, max: 5 }, 5, 1]);
});

test('P3-6-T1 · P3-5-T4 리포트 Markdown에 ## 진입 시나리오 절이 있고 단정 표현이 없으며 시나리오 문장의 태그는 무력화된다', async () => {
  const out = await runFlat((input) => ({
    output: sampleProposal(input, {
      ...noTradeFields,
      scenarios: [sampleScenario(input, {
        rationale: '<img src=x onerror=alert(1)> 지지 재확인', invalidationConditions: ['<b>손절가</b> 이탈'],
        trigger: { ...sampleScenario(input).trigger, confirmation: '<script>x</script> 종가 확인' },
      })],
    }),
  }));
  const report = reportOf(out);
  assert.equal(report.reportSchemaVersion, 3);
  const md = renderMarkdown(report);
  const section = md.slice(md.indexOf(`## ${SCENARIO_HEADING}`), md.indexOf('## 데이터 스냅샷'));
  assert.ok(section.startsWith(`## ${SCENARIO_HEADING}`));
  for (const text of [SCENARIO_NOTICE, NO_WATCH_NOTE, '### 롱 · 눌림 · 주 시나리오 · 재확인 1시간 뒤', '- 진입 구간: ', '- 손익비: ', '- 무효화 조건: ', '시나리오 유효 기한: ']) {
    assert.ok(section.includes(text), text);
  }
  assert.ok(!/<(img|b|script)\b/.test(section), '태그가 그대로 남지 않는다');
  assert.ok(section.includes('&lt;img') && section.includes('&lt;script>'));
  assert.equal(ASSERTIVE.test(section.replace(/&lt;.*?>/g, '')), false);
  assert.ok(md.includes(DISCLAIMER)); // P3-6-R5
  for (const fixed of [SCENARIO_NOTICE, SCENARIO_EXPIRED, NO_WATCH_NOTE, NO_WAIT_PLAN_NOTE, NO_EQUITY_NOTE, TRANCHE_RULE_NOTE]) assert.equal(ASSERTIVE.test(fixed), false, fixed);
});

// ── 규칙 엔진 결과 → 표시 (단위) ──

const scn = (over: Partial<Scenario> = {}): Scenario => ({
  role: 'PRIMARY', side: 'LONG',
  trigger: { kind: 'PULLBACK', level: 98.5, timeframe: '1h', confirmation: '1시간봉 종가가 98.5 위에서 마감' },
  entry: { type: 'zone', min: 96, max: 100 }, stopLoss: 90, targets: [120], leverage: 3,
  tranches: [{ price: 100, weight: 0.5 }, { price: 98, weight: 0.3 }, { price: 96, weight: 0.2 }],
  invalidationConditions: ['1시간봉 종가 90 이탈'], recheckAfterMinutes: 90, evidenceRefs: ['derived:rsi14'], rationale: '지지 구간 재확인',
  ...over,
});
const noTrade = (scenarios: Scenario[]) => proposal({ ...noTradeFields, bias: 'NEUTRAL', scenarios });
const flat = (equity: number | null = 1000) => held({}, { none: true, equity });
/** 현재가 100, ATR 0.8 (ruleCtx 기본값) */
function decide(scenarios: Scenario[], equity: number | null = 1000): FinalDecision {
  const ctx = flat(equity);
  return decisionOf(applyRules(noTrade(scenarios), ruleCtx('algorithm', { positionContext: ctx })), ctx, 'algorithm');
}

test('P3-6-R3 분할 진입은 가격·비중·수량·누적 수량 표와 전부 체결 시 손절 손실 ≤ 총 자산의 N% 문구로 표시한다 (P3-3-T1 수치)', () => {
  const d = decide([scn()]);
  const c = entryPlanView(d)!.cards[0]!;
  assert.deepEqual(c.tranches?.rows, [
    { label: '1차', price: '100', weight: '50%', quantity: '0.581395', cumulative: '0.581395' },
    { label: '2차', price: '98', weight: '30%', quantity: '0.348837', cumulative: '0.930232' },
    { label: '3차', price: '96', weight: '20%', quantity: '0.232558', cumulative: '1.16279' },
  ]);
  const sum = c.tranches!.summary;
  assert.equal(sum[0], '평균 진입가 98.6');
  assert.ok(sum.some((x) => /^전부 체결 시 손절 손실 [\d.]+ USDT ≤ 총 자산의 1%$/.test(x)), sum.join(' | '));
  assert.equal(c.tranches!.note, TRANCHE_RULE_NOTE);
  assert.ok(!c.fields.some((f) => f.label === '수량'), '분할이 있으면 단일 수량 대신 표');
  assert.equal(c.recheck, '재확인 1시간 30분 뒤');
});

test('P3-3-R6 총 자산이 없으면 수량 없이 가격·비중만 표시하고 총 자산 입력 안내가 붙는다', () => {
  const e = entryPlanView(decide([scn()], null))!;
  assert.deepEqual(e.warnings, [NO_EQUITY_NOTE]);
  assert.deepEqual(e.cards[0]!.tranches?.rows[0], { label: '1차', price: '100', weight: '50%', quantity: null, cumulative: null });
  assert.deepEqual(e.cards[0]!.tranches?.summary, ['평균 진입가 98.6']);
});

test('P3-4-T3 손익비가 낮으면 카드에 경고가 붙고 시나리오는 유지된다. 숏·이탈 카드는 방향을 글자로만 구분한다', () => {
  const low = entryPlanView(decide([scn({ tranches: null, targets: [103] })]))!.cards[0]!;
  assert.equal(low.warnings.length, 1);
  assert.match(low.warnings[0]!, /^손익비 낮음/);
  const short = entryPlanView(decide([scn({
    role: 'ALTERNATE', side: 'SHORT', tranches: null, trigger: { kind: 'BREAKOUT', level: 99, timeframe: '1h', confirmation: '1시간봉 종가 99 이탈' },
    entry: { type: 'limit', min: 98.5, max: 98.5 }, stopLoss: 100, targets: [95],
  }), scn({ tranches: null })]))!.cards;
  assert.deepEqual(short.map((c) => c.title), ['숏 · 이탈 · 대안 시나리오', '롱 · 눌림 · 주 시나리오']);
  assert.equal(short[0]!.fields[0]!.value, '98.5 (지정가)');
  assert.match(short[0]!.condition, /가격이 99 아래로 이탈/);
});

test('P3-6-T2 가린 판정에서 만든 카드는 수량·손실 금액이 [masked]이고 가격·비중·손익비는 남는다', () => {
  const d = decide([scn(), scn({ role: 'ALTERNATE', tranches: null, entry: { type: 'zone', min: 97, max: 98 }, trigger: { kind: 'PULLBACK', level: 97.5, timeframe: '4h', confirmation: '확인' }, stopLoss: 94 })]);
  const text = JSON.stringify(entryPlanView(maskDecision(d)));
  for (const secret of ['0.581395', '1.16279', '"10 USDT', '합계 수량 1']) assert.ok(!text.includes(secret), secret);
  assert.ok(text.includes(`합계 수량 ${MASK}`) && text.includes(`전부 체결 시 손절 손실 ${MASK} USDT ≤ 총 자산의 1%`) && text.includes(`"quantity":"${MASK}"`));
  assert.ok(text.includes('"price":"100"') && text.includes('"weight":"50%"') && text.includes('평균 진입가 98.6'));
  assert.ok(text.includes(`"value":"${MASK} (`), '단일 수량도 가린다');
});

test('P3-6-T2 maskJobView: 최상위 수량 제안이 없는 NO_TRADE도 시나리오 수량을 가린다', async () => {
  const out = await runFlat((input) => ({ output: sampleProposal(input, { ...noTradeFields, scenarios: [sampleScenario(input)] }) }));
  const v = jobView(out.rec, new Date(out.rec.createdAt));
  const q = out.d!.entryPlan!.scenarios[0]!.sizing!.suggestedQuantity;
  assert.equal(out.d!.sizing, null);
  assert.ok(JSON.stringify(v.panel).includes(`"value":"${q} (`));
  const masked = JSON.stringify(maskJobView(v));
  assert.ok(!masked.includes(String(q)) && !masked.includes(String(out.d!.entryPlan!.scenarios[0]!.sizing!.riskBudget)));
  assert.ok(masked.includes(`"value":"${MASK} (`));
});

test('P3-6-T3 decision/3 이전 판정과 시나리오·경고가 없는 진입 판정은 시나리오 영역이 없다', () => {
  const ctx = flat();
  const d = decisionOf(applyRules(proposal(), ruleCtx('scalp', { positionContext: ctx })), ctx);
  assert.equal(entryPlanView(d), null);
  const { entryPlan: _e, ...old } = d;
  assert.equal(panelView(old as FinalDecision).entryPlan, null);
  assert.deepEqual([minutesLabel(45), minutesLabel(60), minutesLabel(150), minutesLabel(4320)], ['45분', '1시간', '2시간 30분', '3일']);
});
