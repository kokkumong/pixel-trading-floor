import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JobManager } from '../../src/server/jobs.ts';
import type { JobView } from '../../src/server/view.ts';
import {
  bubbles, confidenceBand, ROOM_PROPS, tickerView, consoleEntries, DATA_FLOW, demoScenarioOptions, DISCLAIMER, errorView, floorPlan, initialMode, MARGIN_LABEL, multiRows, needsForcedConfirm, panelModel, planLabel, scenarioModel,
} from '../../src/web/model.js';
import { buildBoard, collectBoardSources } from '../../src/core/board.ts';
import { autoDriver, sampleOutput, sampleProposal, sampleScenario } from '../job-helpers.ts';
import { manager } from '../server/server-helpers.ts';
import { registry, replayNet } from '../data-helpers.ts';

const WEB = fileURLToPath(new URL('../../src/web/', import.meta.url));

async function demoJob(mode: 'algorithm' | 'scalp') {
  const m = new JobManager({ root: mkdtempSync(join(tmpdir(), 'web-')), env: {}, demoDelayMs: 0 });
  const r = await m.start({ symbol: 'BTC', mode, idempotencyKey: `web-${mode}-key1`, demo: true });
  assert.equal(r.kind, 'started');
  await m.idle();
  const id = (r as { jobId: string }).jobId;
  return { view: m.view(id)!, snap: m.snapshot(id)! };
}

/** 화면에 나가는 글자 전부 (패널 + 콘솔 + 말풍선) */
function screenText(view: JobView, snap: unknown): string {
  const p = panelModel(view, Date.parse(view.createdAt));
  return JSON.stringify([p, consoleEntries(view, snap), bubbles(view)]);
}

async function forcedJob(proposal: Record<string, unknown>) {
  const { m } = manager({
    driver: () => autoDriver({ ACE: (input) => ({ output: { ...(sampleOutput('ACE', input) as object), ...proposal } }) }),
  });
  const r = await m.start({ symbol: 'BTC', mode: 'forced_direction', idempotencyKey: `forced-${Math.random().toString(36).slice(2, 10)}` });
  await m.idle();
  return m.view((r as { jobId: string }).jobId)!;
}

test('P0-5-T1 URL로 모드를 지정해도 강제 방향이 고르지지 않고, 탭마다 처음 실행은 확인이 필요하다 (P0-5-R1·R2)', () => {
  assert.equal(initialMode('?mode=forced_direction'), 'algorithm');
  assert.equal(initialMode('?mode=forced_direction&demo=1'), 'algorithm');
  assert.equal(needsForcedConfirm('forced_direction', false), true);
  assert.equal(needsForcedConfirm('forced_direction', true), false);
  assert.equal(needsForcedConfirm('scalp', false), false);
  // 화면 코드는 URL·저장된 값으로 모드를 복원하지 않는다: 확인 여부만 sessionStorage에 둔다
  const js = readFileSync(join(WEB, 'floor.js'), 'utf8');
  assert.equal(/localStorage/.test(js), false);
  assert.equal(/searchParams\.get\(['"]mode['"]\)/.test(js), false);
});

test('P0-5-T4·T5 강제 방향: 결과 패널 안에 시뮬레이션 배지, 근거 부족 표기가 방향보다 먼저, 전용 색 (확신도 80이어도)', async () => {
  const v = await forcedJob({ action: 'ENTER_LONG', unforcedAction: 'NO_TRADE', confidence: 80 });
  assert.equal(v.state, 'COMPLETED', JSON.stringify(v.error));
  const p = panelModel(v, Date.now())!;
  assert.ok(p.badges.includes('강제 방향 시뮬레이션'));
  assert.equal(p.simulation, true);
  assert.equal(p.tone, 'simulation');
  assert.equal(p.notes[0], '근거 부족 — 강제로 고른 방향');
  assert.equal(p.title, '강제 방향 시뮬레이션 · 판정 아님');
  const css = readFileSync(join(WEB, 'floor.css'), 'utf8');
  assert.match(css, /\.tone-simulation/);
  // 패널 템플릿은 배지·notes를 머리글(headline)보다 먼저 둔다
  const html = readFileSync(join(WEB, 'index.html'), 'utf8');
  const badges = html.indexOf('id="panel-badges"');
  const notes = html.indexOf('id="panel-notes"');
  const headline = html.indexOf('id="panel-headline"');
  assert.ok(badges > 0 && badges < notes && notes < headline, '패널 안 순서: 배지 → 근거 부족 표기 → 방향');
  assert.ok(html.indexOf('id="panel"') < badges, '배지는 결과 패널 요소 안');
});

test('P0-3-T6 화면 어디에도 확신도가 %나 숫자로 나오지 않는다 (LOW/MEDIUM/HIGH + 보정 전 안내)', async () => {
  const v = await forcedJob({ action: 'ENTER_LONG', unforcedAction: 'ENTER_SHORT', confidence: 58 });
  const p = panelModel(v, Date.now())!;
  assert.equal(p.confidence, 'MEDIUM');
  assert.equal(p.confidenceNote, '보정 전 점수 · 적중 확률이 아님');
  const text = JSON.stringify([p, consoleEntries(v), bubbles(v)]);
  assert.equal(/확신도[^"]{0,12}\d/.test(text), false, '확신도 옆 숫자 없음');
  assert.equal(/\b58\b/.test(text.replace(/\d+\.\d+|\d{3,}/g, '')), false);
  assert.equal(confidenceBand(49), 'LOW');
  assert.equal(confidenceBand(50), 'MEDIUM');
  assert.equal(confidenceBand(70), 'HIGH');
});

test('P0-2-T1 스캘핑 결과 화면(패널·콘솔·말풍선)에 PM 문구가 없고 방에도 PM 자리가 없다', async () => {
  const { view, snap } = await demoJob('scalp');
  assert.equal(view.state, 'COMPLETED');
  assert.equal(/PM|최종 승인/.test(screenText(view, snap)), false);
  assert.equal(JSON.stringify(floorPlan('scalp')).includes('PM'), false);
  assert.ok(JSON.stringify(floorPlan('algorithm')).includes('"PM"'));
});

test('P1-4-T4 결과 화면 글자에 청산가가 단독으로 없고, 위험 거리는 참고 표기와 가정을 함께 보인다', async () => {
  for (const mode of ['algorithm', 'scalp'] as const) {
    const { view, snap } = await demoJob(mode);
    assert.equal(/청산가/.test(screenText(view, snap)), false, mode);
  }
  const v = await forcedJob({ action: 'ENTER_LONG', unforcedAction: 'ENTER_LONG', confidence: 60 });
  const p = panelModel(v, Date.now())!;
  if (p.risk) {
    assert.equal(p.risk.label, MARGIN_LABEL);
    assert.ok(p.risk.assumptions.length > 0);
  }
  assert.equal(MARGIN_LABEL, '단순 계산상 증거금 소진 지점 (참고)');
});

test('P1-8-R4 데모 결과 패널 안에도 DEMO 표기, 화면 전체 워터마크 요소가 있다', async () => {
  const { view } = await demoJob('algorithm');
  const p = panelModel(view, Date.now())!;
  assert.equal(p.badges[0], 'DEMO · 실제 데이터 아님');
  assert.equal(p.demo, true);
  const html = readFileSync(join(WEB, 'index.html'), 'utf8');
  assert.match(html, /id="watermark"[^>]*>DEMO · 실제 데이터 아님</);
  // PM 기각: 제목은 서버 표기 그대로, 알고리즘은 PM 결정 문구 사용
  assert.equal(p.title, 'PM 기각 → 거래 없음');
});

test('P1-10-T2 화면: 근거를 확인할 수 없는 주장 옆에 근거 확인 불가, 토론 발언에 인용 경고를 표시한다', async () => {
  const { m } = manager({
    driver: () => autoDriver({
      TARO: (input) => {
        const out = sampleOutput('TARO', input) as { claims: { evidenceRefs: string[] }[] };
        out.claims[0]!.evidenceRefs = ['snap:binance.perp.price#/nope'];
        return { output: out };
      },
      BEAR: () => ({ output: { steelman: 'BULL 요지', evidenceRefs: ['derived:rsi14'], openIssues: [], summary: '요약', narrative: '반박' } }),
    }),
  });
  const r = await m.start({ symbol: 'BTC', mode: 'algorithm', idempotencyKey: 'evidence-audit-key' });
  await m.idle();
  const v = m.view((r as { jobId: string }).jobId)!;
  assert.equal(v.state, 'COMPLETED');
  assert.ok(v.evidenceAudit.length >= 2);
  const entries = consoleEntries(v);
  const taro = entries.find((e) => e.role === 'TARO')!;
  assert.ok(taro.lines.includes('[c1 · observation] 관찰 ⚠ 근거 확인 불가 (snap:binance.perp.price#/nope)'), taro.lines.join('\n'));
  assert.ok(taro.lines.includes('[c2 · interpretation] 해석'));
  const bear = entries.find((e) => e.role === 'BEAR')!;
  assert.ok(bear.lines.some((l) => l.startsWith('⚠ 브리핑 인용 없음')), bear.lines.join('\n'));
  assert.equal(entries.find((e) => e.role === 'BULL')!.lines.some((l) => l.startsWith('⚠')), false);
});

test('P0-8-R2·P1-1-T3 실패·취소 작업은 판정 패널에 나오지 않고 오류 코드 안내를 보인다', async () => {
  const { m } = manager({ driver: () => autoDriver({ TARO: () => ({ error: 'E-AUTH' }) }) });
  const r = await m.start({ symbol: 'BTC', mode: 'scalp', idempotencyKey: 'fail-auth-key' });
  await m.idle();
  const v = m.view((r as { jobId: string }).jobId)!;
  assert.equal(v.state, 'FAILED');
  assert.equal(panelModel(v, Date.now()), null);
  const e = errorView(v)!;
  assert.equal(e.code, 'E-AUTH');
  assert.equal(e.hint, '/diagnostics');
  assert.match(e.message, /로그인/);
  const entries = consoleEntries(v);
  assert.equal(entries.some((x) => x.kind === 'final'), false);
  assert.ok(entries.some((x) => x.kind === 'error' && x.title.includes('E-AUTH')));
  // 부분 결과에 판정이 섞여 와도 취소·상한 도달·실패 상태면 패널에 정상 판정으로 보이지 않는다
  const { view } = await demoJob('algorithm');
  for (const state of ['CANCELLED', 'BUDGET_EXCEEDED', 'FAILED', 'SCHEMA_ERROR', 'INTERRUPTED']) {
    assert.equal(panelModel({ ...view, state, terminal: true }, Date.now()), null, state);
  }
});

test('P0-3-R5 유효 기한이 지난 판정은 화면 시각 기준으로 만료 배지가 붙는다', async () => {
  const { view } = await demoJob('algorithm');
  const until = Date.parse(view.finalDecision!.validUntil!);
  assert.ok(panelModel(view, until + 1000)!.badges.includes('만료'));
  // 서버가 실제 시각으로 붙인 만료 배지(녹화 데이터는 시간이 지나면 항상 만료)를 빼고, 화면 시각만 유효 기한 직전으로 비교한다
  const fresh = { ...view, panel: { ...view.panel!, badges: view.panel!.badges.filter((b) => b !== '만료') } };
  assert.equal(panelModel(fresh, until - 1000)!.badges.includes('만료'), false);
});

test('P0-1-R6 실행 전 계획 호출 수와 최악 호출 수 문구', () => {
  const plans = { algorithm: { min: 11, max: 13, maxModelCalls: 17 }, scalp: { min: 5, max: 5, maxModelCalls: 7 } };
  assert.equal(planLabel('algorithm', plans), 'Claude 호출 11~13회 예정 · 최대 17회');
  assert.equal(planLabel('scalp', plans), 'Claude 호출 5회 예정 · 최대 7회');
});

test('P0-6-R3 데이터가 오가는 곳 문안 (명세 6.2)과 첫 화면의 여는 버튼', () => {
  assert.equal(DATA_FLOW.items.length, 6);
  assert.ok(DATA_FLOW.items.some((s) => s.includes('Anthropic의 Claude 서비스로 전송')));
  assert.ok(DATA_FLOW.items.some((s) => s.includes('데모 모드(?demo=1)는 외부 공급자와 Claude에 요청을 보내지 않습니다')));
  const html = readFileSync(join(WEB, 'index.html'), 'utf8');
  assert.match(html, /id="open-data-flow"/);
});

test('P1-2-R10 멀티 거래소 행: 추정값에 배지·산출 거래소·산출 시각', async () => {
  const { net, at } = replayNet('hynix-algorithm');
  const r = registry.resolve('하이닉스', 'algorithm');
  assert.ok(r.ok);
  const board = buildBoard(r.instrument, await collectBoardSources(net, r.instrument), at, false);
  const rows = multiRows(JSON.parse(JSON.stringify(board)));
  const est = rows.find((x) => x.tone === 'estimate')!;
  assert.match(est.note, /^추정 · 직접 체결가 아님 · /);
  assert.match(est.note, /산출 \d\d:\d\d:\d\d UTC/);
  assert.ok(rows.some((x) => x.label.startsWith('KRX 000660')));
  assert.ok(rows.some((x) => x.label === '선물↔KRX 괴리'));
});

test('P1-7-T2 화면 코드는 모델 출력·외부 텍스트를 HTML로 해석하지 않는다 (innerHTML 등 금지)', () => {
  for (const f of readdirSync(WEB).filter((x) => x.endsWith('.js'))) {
    const js = readFileSync(join(WEB, f), 'utf8');
    assert.equal(/\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|DOMParser|createContextualFragment|\beval\(|new Function/.test(js), false, f);
  }
  // 링크를 만드는 곳은 서버가 준 경로만 쓴다 (http/https 외부 링크 없음)
  const js = readFileSync(join(WEB, 'floor.js'), 'utf8');
  assert.equal(/\.href\s*=\s*[^;]*(summary|narrative|title|rationale)/.test(js), false);
});

test('P1-7-T2 모델 응답의 HTML·javascript: 링크는 콘솔·말풍선에 글자 그대로 들어간다', async () => {
  const payload = '<img src=x onerror=alert(1)> [x](javascript:alert(1))';
  const { m } = manager({ driver: () => autoDriver({ TARO: (input) => ({ output: { ...(sampleOutput('TARO', input) as object), summary: payload, narrative: payload } }) }) });
  const r = await m.start({ symbol: 'BTC', mode: 'scalp', idempotencyKey: 'xss-web-key' });
  await m.idle();
  const v = m.view((r as { jobId: string }).jobId)!;
  assert.equal(bubbles(v).TARO, payload);
  assert.ok(consoleEntries(v).some((e) => e.lines.includes(payload)));
});

test('P0-F-R6 /floor(단일 세션) 결과 패널에 단일 세션 분석을 표시한다', async () => {
  const { view } = await demoJob('scalp');
  assert.equal(panelModel(view, Date.now())!.badges.includes('단일 세션 분석'), false);
  const single = { ...view, finalDecision: { ...view.finalDecision!, executionBackend: 'single_session' as const } };
  assert.ok(panelModel(single, Date.now())!.badges.includes('단일 세션 분석'));
});

test('P2-8 데모 포지션 예시 선택지: 기본(포지션 없음) + 현재 모드의 시나리오만', () => {
  const list = [{ name: 'btc-hold', mode: 'scalp', label: 'A' }, { name: 'btc-reduce', mode: 'algorithm', label: 'B' }];
  assert.deepEqual(demoScenarioOptions(list, 'scalp'), [{ value: '', label: '보유 포지션 없음' }, { value: 'btc-hold', label: '보유 예시: A' }]);
  assert.deepEqual(demoScenarioOptions(undefined, 'forced_direction'), [{ value: '', label: '보유 포지션 없음' }]);
});

test('P2-6-T1 화면 패널 모델은 고지 문구를 항상 싣고, 서버 고지와 같은 문구다', async () => {
  const { DISCLAIMER: server } = await import('../../src/core/rules/display.ts');
  assert.equal(DISCLAIMER, server);
});

test('P0-7-T10 티커 표시 모델: 등락 방향·부호·가격 표기·마감 표시', () => {
  const v = tickerView({ items: [
    { id: 'BTC', label: 'BTC', group: 'coin', currency: 'USD', price: 83481.32, changePct: 0.117, closed: false },
    { id: 'KOSPI', label: 'KOSPI', group: 'kr-index', currency: 'POINT', price: 6880.13, changePct: -0.5, closed: true },
    { id: '005930', label: '삼성전자', group: 'kr-stock', currency: 'KRW', price: 271000, changePct: 0.001, closed: false },
  ] });
  assert.deepEqual(v.map((i) => i.tone), ['up', 'down', 'flat']);
  assert.equal(v[0]!.price, '$83,481.32');
  assert.equal(v[0]!.change, '▲ +0.12%');
  assert.equal(v[1]!.price, '6,880.13');
  assert.equal(v[1]!.change, '▼ -0.50%');
  assert.equal(v[1]!.closed, true);
  assert.equal(v[2]!.price, '₩271,000');
  assert.deepEqual(tickerView(null), []);
  assert.deepEqual(tickerView({ items: [] }), []);
});

test('가이드 4-2 모든 방에 벽 소품이 있고, 화면 소스에 없는 종류는 없다', () => {
  const rooms = floorPlan('algorithm').map((r) => r.id);
  for (const id of rooms) assert.ok((ROOM_PROPS as Record<string, string[]>)[id]?.length, id);
  const sprites = readFileSync(join(WEB, 'sprites.js'), 'utf8');
  for (const kind of Object.values(ROOM_PROPS).flat()) assert.ok(sprites.includes(`kind === '${kind}'`), kind);
});

// ── P3 진입 시나리오 카드 (Phase 18) ──

async function scenarioJob(html = false) {
  const { m } = manager({
    driver: () => autoDriver({
      ACE: (input) => ({
        output: sampleProposal(input, {
          action: 'NO_TRADE', bias: 'BULLISH', entry: { type: 'market', min: null, max: null }, stopLoss: null, targets: [], leverage: null,
          scenarios: [sampleScenario(input, html ? { rationale: '<img src=x onerror=alert(1)>', invalidationConditions: ['<b>굵게</b>'] } : {})],
        }),
      }),
    }),
  });
  const r = await m.start({ symbol: 'BTC', mode: 'scalp', idempotencyKey: `scn-${Math.random().toString(36).slice(2, 10)}` });
  await m.idle();
  return m.view((r as { jobId: string }).jobId)!;
}

test('P3-1-T5 시나리오 카드는 진입 색 없이 조건 미충족 문구로 렌더되고 validUntil 이후에는 만료됨을 표시한다', async () => {
  const v = await scenarioJob();
  assert.equal(v.state, 'COMPLETED', JSON.stringify(v.error));
  const until = Date.parse(v.finalDecision!.validUntil!);
  const p = panelModel(v, until - 1000)!;
  assert.equal(p.tone, 'neutral'); // NO_TRADE: 관망 표기는 그대로 (P3-2-R3)
  const e = p.entryPlan!;
  assert.deepEqual([e.heading, e.status, e.expired, e.cards.length], ['진입 시나리오', '조건 미충족 — 아직 진입 신호가 아님', false, 1]);
  assert.match(e.cards[0]!.recheck, /^재확인 .+ 뒤$/);
  assert.equal('tone' in e.cards[0]!, false);
  const late = panelModel(v, until + 1000)!;
  assert.deepEqual([late.entryPlan!.expired, late.entryPlan!.status], [true, '만료됨 — 다시 분석하세요']);
  assert.ok(late.badges.includes('만료'));
  assert.equal(scenarioModel(null, until), null);

  // 카드 스타일은 진입 색(녹색·빨강)을 쓰지 않는다. 방향별 클래스도 만들지 않는다
  const css = readFileSync(join(WEB, 'floor.css'), 'utf8');
  const scnRules = css.split('\n').filter((l) => /^\.(scn-|scenarios)/.test(l));
  assert.ok(scnRules.length >= 8);
  for (const rule of scnRules) assert.equal(/--green|--red|#3ddc84|#ff4d4d/i.test(rule), false, rule);
  const js = readFileSync(join(WEB, 'floor.js'), 'utf8');
  const render = js.slice(js.indexOf('function trancheTable'), js.indexOf('function renderPanel'));
  assert.equal(/tone-|long|short|c\.side/.test(render), false);
});

test('P3-5-T4 시나리오 문장의 HTML 태그는 화면 모델에 글자 그대로 실리고 textContent로만 그린다', async () => {
  const v = await scenarioJob(true);
  const c = panelModel(v, Date.now())!.entryPlan!.cards[0]!;
  assert.deepEqual([c.rationale, c.invalidation], ['<img src=x onerror=alert(1)>', ['<b>굵게</b>']]);
  const js = readFileSync(join(WEB, 'floor.js'), 'utf8');
  const render = js.slice(js.indexOf('function trancheTable'), js.indexOf('function renderPanel'));
  assert.ok(render.includes('c.rationale') && render.includes('c.invalidation') && render.includes('c.condition'));
  assert.equal(/innerHTML|outerHTML|insertAdjacentHTML/.test(render), false);
});
