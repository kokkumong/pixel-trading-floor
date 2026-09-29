import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JobBudget, budgetFor, modelFor, type BudgetConfig } from '../../../src/core/job/budget.ts';
import { callRole, type Validation } from '../../../src/core/job/retry.ts';
import type { ModelRequest } from '../../../src/core/model/driver.ts';
import { createFixtureDriver } from '../../../src/core/model/fixture.ts';
import { createScriptedDriver } from '../../../src/core/model/scripted.ts';
import type { Role } from '../../../src/core/schema/types.ts';

const req = (role: Role = 'TARO'): ModelRequest => ({
  role, systemPrompt: 'sys', input: 'in', jsonSchema: {}, model: 'm', timeoutMs: 0, maxOutputChars: 0,
});
const valid = (o: unknown): Validation<unknown> =>
  o && typeof o === 'object' && 'good' in o ? { ok: true, value: o } : { ok: false, summary: 'good 필드 없음' };
const delays: number[] = [];
const sleep = async (ms: number) => { delays.push(ms); return true; };
const opts = (signal = new AbortController().signal) => ({ validate: valid, signal, sleep });

test('예산 임시값은 명세 8.3과 같다', () => {
  assert.equal(budgetFor('algorithm').maxModelCalls, 17);
  assert.equal(budgetFor('scalp').maxModelCalls, 7);
  assert.equal(budgetFor('algorithm').maxRetriesPerJob, 4);
  assert.equal(budgetFor('scalp').callTimeoutSeconds, 90);
  assert.deepEqual(modelFor('TARO'), { model: 'sonnet', effort: 'low' });
  assert.equal(modelFor('ACE').effort, 'medium');
});

test('P0-1-T3 한 번 재시도하면 retryCallCount 1, modelCallCount가 1 늘고, 재시도 입력에 오류 요약이 붙는다', async () => {
  const d = createScriptedDriver({ TARO: [{ output: { bad: 1 } }, { output: { good: 1 } }] });
  const b = new JobBudget(budgetFor('algorithm'));
  const r = await callRole(d, req(), b, opts());
  assert.ok(r.ok);
  assert.equal(b.modelCallCount, 2);
  assert.equal(b.retryCallCount, 1);
  assert.match(d.calls[1]!.input, /\[이전 응답 오류\].*good 필드 없음/);
  assert.deepEqual(b.calls.map((c) => [c.outcome, c.retried]), [['E-SCHEMA', false], ['ok', true]]);
});

test('재시도는 호출당 1회, 2초 뒤. 두 번 모두 실패하면 E-SCHEMA', async () => {
  delays.length = 0;
  const d = createScriptedDriver({ TARO: [{ output: { bad: 1 } }] });
  const b = new JobBudget(budgetFor('algorithm'));
  const r = await callRole(d, req(), b, opts());
  assert.ok(!r.ok && r.code === 'E-SCHEMA');
  assert.equal(b.modelCallCount, 2);
  assert.deepEqual(delays, [2000]);
  // 재시도 2회로 설정하면 2초, 4초 (지수 증가)
  delays.length = 0;
  const b2 = new JobBudget({ ...budgetFor('algorithm'), maxRetriesPerCall: 2 });
  await callRole(createScriptedDriver({ TARO: [{ error: 'E-TIMEOUT' }] }), req(), b2, opts());
  assert.deepEqual(delays, [2000, 4000]);
});

test('P0-8-T4 인증 실패는 재시도 없이 1회 호출로 끝난다', async () => {
  const d = createScriptedDriver({ TARO: [{ error: 'E-AUTH' }] });
  const b = new JobBudget(budgetFor('algorithm'));
  const r = await callRole(d, req(), b, opts());
  assert.ok(!r.ok && r.code === 'E-AUTH');
  assert.equal(d.calls.length, 1);
  assert.equal(b.modelCallCount, 1);
  const q = await callRole(createScriptedDriver({ TARO: [{ error: 'E-QUOTA' }] }), req(), new JobBudget(budgetFor('algorithm')), opts());
  assert.ok(!q.ok && q.code === 'E-QUOTA' && q.attempts === 1);
});

test('P0-1-T4 호출 중 취소하면 시작된 호출은 세고 이후 호출은 시작하지 않는다', async () => {
  const d = createScriptedDriver({ ACE: [{ hang: true }], PM: [{ output: { good: 1 } }] });
  const b = new JobBudget(budgetFor('algorithm'));
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 50);
  const r = await callRole(d, { ...req('ACE') }, b, opts(ac.signal));
  assert.ok(!r.ok && r.code === 'E-CANCELLED');
  assert.equal(b.modelCallCount, 1);
  const next = await callRole(d, req('PM'), b, opts(ac.signal));
  assert.ok(!next.ok && next.code === 'E-CANCELLED');
  assert.equal(d.calls.length, 1);
});

test('P0-8-R1 호출 상한이면 호출하지 않고 E-BUDGET', async () => {
  const cfg: BudgetConfig = { ...budgetFor('scalp') };
  const b = new JobBudget(cfg);
  b.modelCallCount = cfg.maxModelCalls;
  const d = createScriptedDriver({ TARO: [{ output: { good: 1 } }] });
  const r = await callRole(d, req(), b, opts());
  assert.ok(!r.ok && r.code === 'E-BUDGET');
  assert.equal(d.calls.length, 0);
});

test('P0-8-R1 작업 시간 상한이 지나면 호출하지 않고, 남은 시간 안에 끝나지 않으면 E-BUDGET', async () => {
  let now = 0;
  const b = new JobBudget({ ...budgetFor('scalp'), maxDurationSeconds: 10 }, () => now, 0);
  now = 10_001;
  const d = createScriptedDriver({ TARO: [{ output: { good: 1 } }] });
  assert.ok(await callRole(d, req(), b, opts()).then((r) => !r.ok && r.code === 'E-BUDGET'));
  // 남은 시간(0.2초)이 호출 시간 제한(90초)보다 짧으면 그만큼만 기다리고 E-BUDGET
  const b2 = new JobBudget({ ...budgetFor('scalp'), maxDurationSeconds: 0.2 });
  const r2 = await callRole(createScriptedDriver({ TARO: [{ hang: true }] }), req(), b2, opts());
  assert.ok(!r2.ok && r2.code === 'E-BUDGET');
});

test('P0-8-T1 (호출 계층) 모든 응답이 스키마 오류여도 작업 재시도 예산 안에서 멈춘다', async () => {
  const d = createScriptedDriver({}, () => ({ output: { bad: 1 } }));
  const b = new JobBudget(budgetFor('algorithm'));
  const roles: Role[] = ['TARO', 'DIANA', 'NOVA', 'VIBE', 'BULL', 'BEAR', 'BULL', 'BEAR', 'ACE', 'RISKY', 'SAFE', 'NEUTRAL', 'PM'];
  let failed = false;
  for (const role of roles) {
    const r = await callRole(d, req(role), b, opts());
    if (!r.ok) { failed = true; break; } // 작업 엔진은 첫 SCHEMA_ERROR에서 작업을 끝낸다
  }
  assert.ok(failed);
  assert.ok(b.modelCallCount <= 17);
  assert.equal(b.modelCallCount, 2);
});

test('P0-1-T5 데모 재생은 modelCallCount = 0', async () => {
  const d = createFixtureDriver({ TARO: [{ good: 1 }] });
  const b = new JobBudget(budgetFor('scalp'));
  const r = await callRole(d, req(), b, opts());
  assert.ok(r.ok);
  assert.equal(b.modelCallCount, 0);
  assert.equal(b.calls.length, 1);
});
