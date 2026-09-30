// P2 포지션 명세 5·6장: 화면·리포트 문구, 고지, 마스킹 (Phase 14)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  BIAS_NOTE, DISCLAIMER, NO_POSITION_BIAS_NOTE, panelView, positionSummary,
} from '../../src/core/rules/display.ts';
import { MASK, maskDecision, maskPositionContext, maskReport } from '../../src/core/position/mask.ts';
import { renderMarkdown } from '../../src/core/report/markdown.ts';
import { buildReport, type Report } from '../../src/core/report/report.ts';
import { applyRules } from '../../src/core/rules/engine.ts';
import { proposal, ruleCtx } from '../helpers.ts';
import { bookRead, decisionOf, held, POS, runWithBook, SECRET } from '../position-helpers.ts';

const keep = { entry: { type: 'market' as const, min: null, max: null }, stopLoss: null, targets: [], leverage: 5 };
const rules = (p: ReturnType<typeof proposal>, ctx: ReturnType<typeof held> | null) => applyRules(p, ruleCtx('scalp', { positionContext: ctx }));
const FORBIDDEN = ['확실', '보장', '무조건'];

function decisions() {
  const h = held();
  const flat = held({}, { none: true });
  return {
    hold: [decisionOf(rules(proposal({ action: 'HOLD', positionRef: POS, ...keep }), h), h), h] as const,
    reduce: [decisionOf(rules(proposal({ action: 'REDUCE', positionRef: POS, sizeFraction: 0.5, ...keep }), h), h), h] as const,
    exit: [decisionOf(rules(proposal({ action: 'EXIT', bias: 'BEARISH', positionRef: POS, ...keep }), h), h), h] as const,
    enter: [decisionOf(rules(proposal({}), flat), flat), flat] as const,
    noTrade: [decisionOf(rules(proposal({ action: 'NO_TRADE', entry: { type: 'market', min: null, max: null }, stopLoss: null, targets: [], leverage: null }), flat), flat), flat] as const,
  };
}

test('P2-6-T1 판정 패널에 고지 문구가 항상 있고 고정 문구에 단정 표현이 없다', () => {
  assert.equal(DISCLAIMER, '자동 분석 결과이며 투자 자문이 아닙니다. 주문은 직접 실행하며 손실의 책임은 본인에게 있습니다.');
  const all = decisions();
  for (const [name, [d, pc]] of Object.entries(all)) {
    const v = panelView(d, new Date('2026-09-30T00:00:00Z'), pc);
    assert.equal(v.disclaimer, DISCLAIMER, name);
  }
  // 데이터 부족·강제 방향도 고지가 있다
  const [d] = all.hold;
  assert.equal(panelView({ ...d, action: null, bias: null, status: 'INSUFFICIENT_DATA' }).disclaimer, DISCLAIMER);
  assert.equal(panelView({ ...d, forcedDirection: true, mode: 'forced_direction', positionRef: null }).disclaimer, DISCLAIMER);
  // 화면·리포트 고정 문구를 담은 파일에 단정 표현이 없다 (P2-6-R6)
  for (const f of ['src/core/rules/display.ts', 'src/core/report/markdown.ts', 'src/core/position/context.ts', 'src/core/rules/sizing.ts', 'src/web/model.js', 'src/web/position.js', 'src/web/index.html']) {
    const s = readFileSync(f, 'utf8');
    for (const w of FORBIDDEN) assert.ok(!s.includes(w), `${f}: ${w}`);
  }
});

test('P2-6-T2 REDUCE·EXIT는 녹색으로 표시되지 않고 HOLD는 중립색', () => {
  const all = decisions();
  assert.equal(panelView(...pv(all.reduce)).tone, 'caution');
  assert.equal(panelView(...pv(all.exit)).tone, 'caution');
  assert.equal(panelView(...pv(all.hold)).tone, 'neutral');
  // 화면 CSS: 녹색은 롱 톤에만 쓴다
  const css = readFileSync('src/web/floor.css', 'utf8');
  const greens = css.split('\n').filter((l) => l.includes('.tone-') && l.includes('var(--green)'));
  assert.deepEqual(greens.map((l) => l.split(' ')[0]), ['.tone-long']);
});
const pv = ([d, pc]: readonly [Parameters<typeof panelView>[0], ReturnType<typeof held>]) => [d, new Date('2026-09-30T00:00:00Z'), pc] as const;

test('P2-6-R3 포지션 인지 판정은 사용한 포지션 요약(방향·평단·수익률·손절·기준 시각)을 표시한다', () => {
  const [d, pc] = decisions().hold;
  const v = panelView(d, new Date(), pc);
  assert.equal(v.position, positionSummary(pc));
  const s = v.position!;
  for (const part of ['무기한 롱 5배', '평단 95', '수익률 +5.26%', '레버리지 반영 +26.32%', '손절 92', '기준 2026-09-30T00:00:00Z']) assert.ok(s.includes(part), `${part} in ${s}`);
  assert.ok(!s.includes('수량') && !s.includes('1000'), '수량·총 자산은 요약에 없다');
  // 포지션이 없거나 판정에 쓰지 않았으면 요약이 없다
  const [e, flat] = decisions().enter;
  assert.equal(panelView(e, new Date(), flat).position, null);
  assert.equal(panelView(d, new Date()).position, null);
  // 손절 없는 숏
  const sh = held({ side: 'SHORT', avgEntryPrice: 105, stopLoss: null, leverage: 1 });
  assert.ok(positionSummary(sh)!.includes('무기한 숏 1배 · 평단 105 · 수익률 +4.76% · 손절 없음'));
});

test('P2-6-R3 NO_TRADE 주석은 포지션 없음이 확인된 분석과 보유 정보가 없는 분석을 구분한다', () => {
  const [d, flat] = decisions().noTrade;
  assert.equal(d.action, 'NO_TRADE');
  const confirmed = panelView(d, new Date(), flat).notes;
  assert.ok(confirmed.includes(NO_POSITION_BIAS_NOTE) && !confirmed.includes(BIAS_NOTE));
  const unknown = panelView(d, new Date(), null).notes;
  assert.ok(unknown.includes(BIAS_NOTE) && !unknown.includes(NO_POSITION_BIAS_NOTE));
  const missing = panelView(d, new Date(), { ...flat, book: { ...flat.book, status: 'missing' } }).notes;
  assert.ok(missing.includes(BIAS_NOTE));
});

// ── 리포트·마스킹 (엔진 경로) ──

const META = { claudeCliVersion: '2.1.284 (Claude Code)' };

/** 무기한 작업 + 현물 보유 북: 이 시장 보유 없음(다른 시장 보유 한 줄) + 총 자산 → 진입 수량 제안 */
async function flatWithSizing() {
  const out = await runWithBook('scalp', {}, [], bookRead('spot'));
  assert.equal(out.rec.state, 'COMPLETED');
  assert.equal(out.d?.action, 'ENTER_LONG');
  assert.ok(out.d?.sizing, '수량 제안이 있어야 한다');
  return { ...out, report: buildReport(out.job, META, new Date(Date.parse(out.rec.createdAt) + 60_000)) };
}

test('P2-2-R4 리포트 v2는 positionContext 전체를 담고 Markdown에 포지션 요약·고지를 쓴다 (총 자산은 Markdown에 없음)', async () => {
  const { report } = await flatWithSizing();
  assert.equal(report.reportSchemaVersion, 2);
  assert.equal(report.positionContext?.account.equity, SECRET.equity);
  const md = renderMarkdown(report);
  assert.ok(md.includes(`> **고지** — ${DISCLAIMER}`));
  assert.ok(md.trimEnd().endsWith(`${DISCLAIMER} 이 앱에는 주문 기능이 없습니다.`));
  assert.ok(md.includes('### 보유 포지션') && md.includes('다른 시장 보유 있음'));
  assert.ok(md.includes(`제안 수량 ${report.finalDecision.sizing!.suggestedQuantity}`), 'Markdown은 제안 수량을 쓴다 (P2-5.1)');
  assert.ok(!md.includes(String(SECRET.equity)) && !md.includes(String(report.finalDecision.sizing!.riskBudget)), '총 자산·손실 한도 금액 없음');
  for (const w of FORBIDDEN) assert.ok(!md.includes(w), w);

  // 보유 포지션 판정: 요약과 판정 뒤 계획
  const held = await runWithBook('scalp');
  const hr = buildReport(held.job, META, new Date(Date.parse(held.rec.createdAt) + 60_000));
  const hmd = renderMarkdown(hr);
  assert.ok(hmd.includes('- 사용한 포지션: 무기한 롱 10배 · 평단 80000'), hmd.slice(0, 800));
  assert.ok(hmd.includes('- 판정 뒤 손절: 78000'));
  assert.ok(!hmd.includes(String(SECRET.quantity)) && !hmd.includes(SECRET.note));
});

test('P2-2-R4 이전 리포트(v1, decision/2)도 Markdown으로 읽힌다', async () => {
  const { report } = await flatWithSizing();
  const { positionContext: _pc, ...rest } = report;
  const { positionRef: _r, positionPlan: _p, sizing: _s, ...d2 } = report.finalDecision;
  const old = { ...rest, reportSchemaVersion: 1, finalDecision: { ...d2, schemaVersion: 'decision/2' } } as unknown as Report;
  const md = renderMarkdown(old);
  assert.ok(md.includes(DISCLAIMER) && !md.includes('### 보유 포지션'));
});

test('P2-5-T3 maskReport: 금액·수량·총 자산은 [masked], 가격·비율은 남는다. 원본은 바뀌지 않는다', async () => {
  const { report } = await flatWithSizing();
  const before = JSON.stringify(report);
  const m = maskReport(report);
  assert.equal(JSON.stringify(report), before, '원본 불변');
  const s = m.finalDecision.sizing!;
  assert.deepEqual([s.suggestedQuantity, s.riskBudget, s.marginRequired], [MASK, MASK, MASK]);
  assert.equal(s.entryPrice, report.finalDecision.sizing!.entryPrice);
  assert.equal(s.riskPerTradePercent, 1);
  assert.equal(m.positionContext?.account, MASK);
  const text = JSON.stringify(m) + renderMarkdown(m);
  for (const secret of [String(SECRET.equity), String(report.finalDecision.sizing!.suggestedQuantity), String(report.finalDecision.sizing!.riskBudget)]) {
    assert.ok(!text.includes(secret), secret);
  }
  assert.ok(renderMarkdown(m).includes(`제안 수량 ${MASK}`));

  const held = await runWithBook('scalp');
  const hr = maskReport(buildReport(held.job, META, new Date(Date.parse(held.rec.createdAt) + 60_000)));
  assert.equal(hr.positionContext?.position?.quantity, MASK);
  assert.equal(hr.positionContext?.position?.avgEntryPrice, 80000);
  assert.ok(!JSON.stringify(hr).includes(String(SECRET.quantity)));
  assert.equal(maskDecision(null), null);
  assert.equal(maskPositionContext(null), null);
});
