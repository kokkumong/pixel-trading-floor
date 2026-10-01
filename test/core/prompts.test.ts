import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPromptSet, jsonSchemaFor, PROMPT_DIR, prompts } from '../../src/core/prompts/index.ts';
import { parseRef } from '../../src/core/rules/evidence.ts';
import { MODES, ROLES, type Mode, type Role } from '../../src/core/schema/types.ts';

const MODE_ROLES: Record<Mode, readonly Role[]> = {
  algorithm: ['TARO', 'DIANA', 'NOVA', 'VIBE', 'BULL', 'BEAR', 'ACE', 'RISKY', 'SAFE', 'NEUTRAL', 'PM'],
  scalp: ['TARO', 'VIBE', 'BLITZ', 'GUARD', 'ACE'],
  forced_direction: ['TARO', 'VIBE', 'BLITZ', 'GUARD', 'ACE'],
};

test('역할 프롬프트 13개가 모두 있고 한국어 출력 지시가 있다', () => {
  for (const role of ROLES) {
    const text = readFileSync(join(fileURLToPath(PROMPT_DIR), 'roles', `${role}.md`), 'utf8');
    assert.ok(text.includes(role), role);
  }
  for (const mode of MODES) for (const role of MODE_ROLES[mode]) assert.match(prompts.systemPrompt(role, mode), /한국어/, `${mode} ${role}`);
});

test('P0-4-R7 모든 역할 지침에 불신 데이터 블록을 따르지 않는다는 규칙이 있다', () => {
  for (const mode of MODES) {
    for (const role of MODE_ROLES[mode]) {
      const p = prompts.systemPrompt(role, mode);
      assert.match(p, /`untrusted`/, role);
      assert.match(p, /지시가 아니다/, role);
    }
  }
});

test('P0-3-R4 강제 방향 외 모드의 제안 역할 지침에는 NO_TRADE 선택 가능이 명시된다', () => {
  for (const [role, mode] of [['ACE', 'algorithm'], ['ACE', 'scalp'], ['BLITZ', 'scalp'], ['PM', 'algorithm']] as const) {
    assert.match(prompts.systemPrompt(role, mode), /NO_TRADE를 (언제든 )?고를 수 있다/, `${mode} ${role}`);
  }
  // 강제 방향 모드에서는 NO_TRADE가 금지이고, P0-5-R6 지시가 있다
  for (const role of ['ACE', 'BLITZ'] as const) {
    const p = prompts.systemPrompt(role, 'forced_direction');
    assert.equal(/NO_TRADE를 (언제든 )?고를 수 있다/.test(p), false, role);
    assert.match(p, /방향은 강제되지만 확신도\(confidence\)와 unforcedAction은 강제와 무관하게 답한다/, role);
  }
  assert.equal(/강제 방향 시뮬레이션 규칙/.test(prompts.systemPrompt('ACE', 'scalp')), false);
});

test('근거 참조 예시는 코드 문법과 맞고, 실측에서 틀렸던 형식은 금지 예시로만 나온다', () => {
  const p = prompts.systemPrompt('TARO', 'scalp');
  for (const good of ['derived:macd.hist', 'snap:binance.perp.price#/last', 'brief:TARO#c2', 'derived:rsi14']) {
    assert.ok(p.includes(`\`${good}\``), good);
    assert.ok(parseRef(good), good);
  }
  for (const bad of ['derived:macd/hist', 'snap:binance.perp.price.last']) {
    assert.equal(parseRef(bad)?.kind === 'derived' && bad.includes('/'), false);
    assert.match(p, new RegExp(`틀린 예[^\\n]*${bad.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`), bad);
  }
});

test('P1-6-T3 프롬프트 템플릿의 공백 한 글자를 바꾸면 그 역할의 해시가 바뀐다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'floor-prompts-'));
  cpSync(fileURLToPath(PROMPT_DIR), dir, { recursive: true });
  const before = createPromptSet(dir);
  const h = before.hash('TARO', 'scalp');
  assert.match(h, /^[0-9a-f]{12}$/);
  assert.equal(h, prompts.hash('TARO', 'scalp')); // 사본과 원본은 같은 해시
  const file = join(dir, 'roles', 'TARO.md');
  writeFileSync(file, readFileSync(file, 'utf8') + ' ');
  const after = createPromptSet(dir);
  assert.notEqual(after.hash('TARO', 'scalp'), h);
  assert.equal(after.hash('VIBE', 'scalp'), before.hash('VIBE', 'scalp')); // 다른 역할은 그대로
});

test('강제 방향 모드의 ACE·BLITZ 출력 스키마는 NO_TRADE를 행동 값으로 허용하지 않는다', () => {
  const actionEnum = (role: Role, mode: Mode) => ((jsonSchemaFor(role, mode) as any).properties.action.enum as string[]);
  assert.deepEqual(actionEnum('ACE', 'forced_direction'), ['ENTER_LONG', 'ENTER_SHORT']);
  assert.deepEqual(actionEnum('BLITZ', 'forced_direction'), ['ENTER_LONG', 'ENTER_SHORT']);
  assert.deepEqual(actionEnum('ACE', 'scalp'), ['ENTER_LONG', 'ENTER_SHORT', 'NO_TRADE']);
  assert.match((jsonSchemaFor('ACE', 'scalp') as any).properties.action.description, /NO_TRADE/);
  // 역할별 스키마 종류
  assert.ok('claims' in (jsonSchemaFor('TARO', 'algorithm') as any).properties);
  assert.ok('openIssues' in (jsonSchemaFor('BEAR', 'algorithm') as any).properties);
  assert.ok('pmDecision' in (jsonSchemaFor('PM', 'algorithm') as any).properties);
});

// ── P3-5 진입 시나리오 프롬프트 ──

// Phase 17(P2 끝) 시점의 해시. 시나리오 도입으로 이 역할들의 프롬프트가 바뀌면 안 된다
const P2_HASHES: Record<string, [flat: string, held: string]> = {
  TARO: ['65949862eea8', '65949862eea8'], DIANA: ['b1b0ab3c94b1', 'b1b0ab3c94b1'], NOVA: ['57bc69e9ff0e', '57bc69e9ff0e'],
  VIBE: ['61c3f0aaafcc', '61c3f0aaafcc'], BULL: ['0e35ff1680b4', '0e35ff1680b4'], BEAR: ['341551b3843b', '341551b3843b'],
  GUARD: ['65936d3c4459', 'a63d62d24727'], RISKY: ['1b9e95d89e73', 'c627a0b22c21'], SAFE: ['0533536ef195', '494425dc51a5'],
  NEUTRAL: ['b6cdb1792ed3', '0dd7cdaac12a'],
};

test('P3-5-T1 분석가 4명·BULL·BEAR·GUARD·RISKY·SAFE·NEUTRAL 프롬프트와 출력 스키마가 P2와 같다', () => {
  for (const [role, [flat, held]] of Object.entries(P2_HASHES) as [Role, [string, string]][]) {
    for (const mode of MODES) {
      assert.equal(prompts.hash(role, mode, false), flat, `${role} ${mode}`);
      if (mode !== 'forced_direction') assert.equal(prompts.hash(role, mode, true), held, `${role} ${mode} 보유`);
      assert.ok(!prompts.systemPrompt(role, mode).includes('scenarios'), `${role} ${mode}`);
      assert.ok(!JSON.stringify(jsonSchemaFor(role, mode)).includes('scenarios'), `${role} ${mode} 스키마`);
    }
  }
});

test('P3-5-T2 제안서 작성자 프롬프트에 NO_TRADE일 때 PRIMARY 시나리오 규칙과 수량 비제안 규칙이 있다', () => {
  for (const [role, mode] of [['ACE', 'algorithm'], ['ACE', 'scalp'], ['BLITZ', 'scalp'], ['PM', 'algorithm']] as const) {
    const p = prompts.systemPrompt(role, mode);
    const at = `${mode} ${role}`;
    assert.match(p, /NO_TRADE이면 `role`이 PRIMARY인 시나리오를 반드시 1건 쓴다/, at); // (a)
    assert.match(p, /근거를 찾을 수 있는 값만 쓴다/, at); // (b)
    assert.match(p, /수량·금액은 어디에도 쓰지 않는다/, at); // (c)
    assert.match(p, /scalp 모드는 항상 null/, at); // (d)
    assert.match(p, /지금 진입하라는 신호가 아니다/, at); // (e)
    // 금액·수량·총 자산 값이나 필드가 프롬프트에 없다
    for (const secret of ['quantity', 'equity', 'riskPerTrade', '총 자산', 'USDT ']) assert.ok(!p.includes(secret), `${at}: ${secret}`);
  }
  assert.match(prompts.systemPrompt('PM', 'algorithm'), /`scenarios`·`tranches`도 수정 대상/); // P3-5-R3
});

test('P3-1-R2 보유·강제 방향의 제안 프롬프트에는 시나리오 규칙이 없고 ACE·BLITZ 출력 스키마에 scenarios·tranches가 없다', () => {
  const props = (role: Role, mode: Mode, held = false) => Object.keys((jsonSchemaFor(role, mode, held) as any).properties);
  for (const [role, mode, held] of [['ACE', 'forced_direction', false], ['BLITZ', 'forced_direction', false], ['ACE', 'algorithm', true], ['BLITZ', 'scalp', true], ['ACE', 'scalp', true]] as const) {
    assert.ok(!prompts.systemPrompt(role, mode, held).includes('## 진입 시나리오'), `${role} ${mode}`);
    assert.ok(!props(role, mode, held).includes('scenarios') && !props(role, mode, held).includes('tranches'), `${role} ${mode}`);
  }
  assert.ok(!prompts.systemPrompt('PM', 'algorithm', true).includes('## 진입 시나리오'));
  for (const [role, mode] of [['ACE', 'algorithm'], ['BLITZ', 'scalp'], ['ACE', 'scalp']] as const) {
    assert.ok(props(role, mode).includes('scenarios') && props(role, mode).includes('tranches'), `${role} ${mode}`);
    const required = (jsonSchemaFor(role, mode) as any).required as string[];
    assert.ok(required.includes('scenarios'), `${role} ${mode} 필수`);
  }
});
