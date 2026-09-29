import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoleInput, fitInput, InputBudgetError } from '../../../src/core/data/project.ts';
import type { Briefing } from '../../../src/core/schema/agents.ts';
import type { Role } from '../../../src/core/schema/types.ts';
import { replaySnapshot } from '../../data-helpers.ts';

const briefing = (role: 'TARO' | 'DIANA' | 'NOVA' | 'VIBE'): Briefing => ({
  schemaVersion: 'briefing/1', briefingId: `job-test:${role}`, role, bias: 'NEUTRAL',
  claims: [{ claimId: 'c1', kind: 'observation', text: `${role} 관찰`, evidenceRefs: ['derived:rsi14'] }],
  counterScenario: '반대', changeTriggers: [], dataLimitations: [], summary: '요약', narrative: '긴 전문 '.repeat(50),
});

test('P0-4-T6 TARO 입력의 봉 개수가 상한을 넘지 않는다 (algorithm 30, scalp 32)', async () => {
  const a = (await replaySnapshot('btc-algorithm')).snap;
  const s = (await replaySnapshot('btc-scalp')).snap;
  assert.equal(buildRoleInput(a, 'TARO').recentBars!.rows.length, 30);
  assert.equal(buildRoleInput(s, 'TARO').recentBars!.rows.length, 32);
  assert.equal(buildRoleInput(s, 'BLITZ').recentBars!.rows.length, 32);
  // P0-4-R8: 지표 계산용 전체 캔들은 모델 입력에 없다
  for (const role of ['TARO', 'DIANA', 'BLITZ', 'ACE'] as Role[]) {
    const text = JSON.stringify(buildRoleInput(s, role));
    assert.equal(text.includes('"candles"'), false, role);
  }
});

test('P1-10-T1 애널리스트 입력에는 다른 애널리스트의 briefingId가 없다', async () => {
  const { snap } = await replaySnapshot('btc-algorithm');
  const briefings = { TARO: briefing('TARO'), DIANA: briefing('DIANA'), NOVA: briefing('NOVA'), VIBE: briefing('VIBE') };
  for (const role of ['TARO', 'DIANA', 'NOVA', 'VIBE'] as const) {
    // 앞선 출력을 넘겨도 애널리스트 입력에는 들어가지 않는다
    const text = JSON.stringify(buildRoleInput(snap, role, { briefings }));
    assert.equal(text.includes('job-test:'), false, role);
  }
  // 토론자는 애널리스트 브리핑을 받되, 토큰을 아끼려고 전문(narrative)은 받지 않는다
  const bull = buildRoleInput(snap, 'BULL', { briefings });
  const text = JSON.stringify(bull);
  assert.ok(text.includes('job-test:TARO'));
  assert.equal(text.includes('긴 전문'), false);
});

test('P1-9-T1 기본 설정에서 어떤 역할 입력에도 과거 리포트가 없다', async () => {
  const { snap } = await replaySnapshot('btc-algorithm');
  for (const role of ['TARO', 'DIANA', 'NOVA', 'VIBE', 'BULL', 'BEAR', 'ACE', 'RISKY', 'SAFE', 'NEUTRAL', 'PM'] as Role[]) {
    const text = JSON.stringify(buildRoleInput(snap, role));
    assert.equal(/retrospect|report|리포트/i.test(text), false, role);
  }
});

test('P0-4-R7 뉴스는 untrusted 블록으로만 전달된다', async () => {
  const { snap } = await replaySnapshot('tsla-algorithm');
  const nova = buildRoleInput(snap, 'NOVA');
  assert.ok((nova.untrusted?.news?.length ?? 0) > 0);
  assert.equal('news.google' in nova.sources, false);
  const vibe = buildRoleInput(snap, 'VIBE');
  assert.equal(vibe.untrusted?.news?.every((n) => !('summary' in n)), true); // VIBE는 제목만
  assert.equal(buildRoleInput(snap, 'TARO').untrusted, undefined);
});

test('사용할 수 없는 소스(만료·시각 미확인·추정)는 입력에 넣지 않는다', async () => {
  const { snap } = await replaySnapshot('hynix-scalp');
  const ace = buildRoleInput(snap, 'ACE');
  const keys = Object.keys(ace.sources);
  assert.ok(keys.includes('binance.perp.price'));
  assert.equal(keys.some((k) => k.startsWith('gate.') || k.startsWith('tapbit.')), false);
  assert.equal(ace.priceBasis?.sourceRef, 'binance.perp.price');
});

test('P0-8-R3 입력 상한을 넘으면 뉴스 → 최근 봉 순으로 줄이고, 그래도 넘으면 거부', async () => {
  const { snap } = await replaySnapshot('tsla-algorithm');
  const nova = buildRoleInput(snap, 'NOVA');
  const size = JSON.stringify(nova).length;
  const fit = fitInput(nova, size - 50, 0);
  assert.ok(fit.reductions.some((r) => r.startsWith('뉴스')));
  assert.ok(fit.input.dataWarnings.some((w) => w.startsWith('입력 축소')));

  const taro = buildRoleInput(snap, 'TARO');
  const tsize = JSON.stringify(taro).length;
  const t = fitInput(taro, tsize - 200, 0);
  assert.ok(t.input.recentBars!.rows.length < 30);
  assert.throws(() => fitInput(taro, 500, 0), InputBudgetError);
  assert.equal(fitInput(taro, 1_000_000, 0).reductions.length, 0);
});

test('P0 명세 v0.6 4.3: 스캘핑에서도 VIBE는 뉴스 제목을 받는다 (요약 없이)', async () => {
  const { snap } = await replaySnapshot('btc-scalp');
  const news = snap.sources.find((x) => x.id === 'news.google');
  assert.equal(news?.required, false);
  const vibe = buildRoleInput(snap, 'VIBE');
  assert.ok((vibe.untrusted?.news?.length ?? 0) > 0);
  assert.equal(vibe.untrusted?.news?.every((n) => !('summary' in n)), true);
  for (const role of ['TARO', 'BLITZ', 'GUARD', 'ACE'] as Role[]) assert.equal(buildRoleInput(snap, role).untrusted, undefined, role);
});
