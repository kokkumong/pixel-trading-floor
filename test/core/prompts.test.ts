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
