import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRoleInput } from '../../../src/core/data/project.ts';
import type { Job } from '../../../src/core/job/engine.ts';
import { runJob } from '../../../src/core/job/runner.ts';
import { MODE_PATHS } from '../../../src/core/job/state.ts';
import { createFixtureDriver } from '../../../src/core/model/fixture.ts';
import { panelView } from '../../../src/core/rules/display.ts';
import type { Mode, Role } from '../../../src/core/schema/types.ts';
import { replayAcquirer } from '../../data-helpers.ts';
import { autoDriver, parseRequestInput, sampleOutput, sampleProposal, tempEngine, type Override } from '../../job-helpers.ts';

const FIXTURE: Record<Mode, string> = { algorithm: 'btc-algorithm', scalp: 'btc-scalp', forced_direction: 'btc-scalp' };
const noSleep = async () => true;

async function setup(mode: Mode, iface: 'web' | 'floor' = 'web', opts: { fail?: string[]; symbol?: string } = {}) {
  const r = replayAcquirer(FIXTURE[mode], opts);
  const t = tempEngine(r.at);
  const job = await t.engine.createJob({ idempotencyKey: `k-${Math.random()}`, mode, symbolInput: r.symbol, interface: iface }, r.acquirer);
  return { ...t, job };
}

async function run(mode: Mode, overrides: Partial<Record<Role, Override>> = {}) {
  const s = await setup(mode);
  const driver = autoDriver(overrides);
  await runJob(s.engine, s.job, driver, new AbortController().signal, { sleep: noSleep });
  return { ...s, driver, rec: s.job.record, d: s.job.record.finalDecision };
}

const states = (job: Job) => job.record.history.map((h) => h.state);
const calledRoles = (d: { calls: { role: Role }[] }) => d.calls.map((c) => c.role);

test('P1-1-T1 · P0-1-T1 알고리즘 정상 작업: 경로가 명세와 같고 호출 수 = 11 + 2 × (라운드 − 1)', async () => {
  const { rec, driver, d } = await run('algorithm');
  assert.equal(rec.state, 'COMPLETED');
  assert.deepEqual(states({ record: rec, snapshot: null }), MODE_PATHS.algorithm);
  assert.equal(rec.debate.roundCount, 2);
  assert.equal(rec.debate.messageCount, 4);
  assert.equal(rec.debate.stopReason, 'MAX_ROUNDS');
  assert.equal(rec.usage.modelCallCount, 11 + 2 * (rec.debate.roundCount - 1));
  assert.equal(rec.usage.modelCallCount, driver.calls.length);
  assert.equal(rec.usage.calls.length, 13); // P0-8-R7 호출별 기록
  assert.deepEqual(rec.plannedModelCallRange, { min: 11, max: 13 });
  assert.deepEqual(calledRoles(driver).slice(4), ['BULL', 'BEAR', 'BULL', 'BEAR', 'ACE', 'RISKY', 'SAFE', 'NEUTRAL', 'PM']);
  assert.deepEqual(new Set(calledRoles(driver).slice(0, 4)), new Set(['TARO', 'DIANA', 'NOVA', 'VIBE']));
  assert.equal(rec.usage.roleTurnCount, null); // 브라우저 경로는 호출 수로 센다
  // 최종 판정: PM 승인, 규칙 통과
  assert.equal(d?.status, 'VALID');
  assert.equal(d?.action, 'ENTER_LONG');
  assert.equal(d?.pmDecision, 'APPROVE');
  assert.equal(d?.finalDecisionMaker, 'PM');
  assert.equal(d?.ruleEngine.verdict, 'PASS', JSON.stringify(d?.ruleEngine));
  assert.equal(d?.executionBackend, 'subprocess_per_role');
  assert.equal(d?.confidence?.band, 'MEDIUM');
  assert.equal(Date.parse(d!.validUntil!) - Date.parse(d!.decidedAt), 120 * 60_000);
  // P1-6-R3 역할별 프롬프트 해시 기록
  assert.deepEqual(Object.keys(rec.promptHashes).sort(), ['ACE', 'BEAR', 'BULL', 'DIANA', 'NEUTRAL', 'NOVA', 'PM', 'RISKY', 'SAFE', 'TARO', 'VIBE']);
});

test('P0-1-T2 1라운드 BEAR의 openIssues가 비면 2라운드 없이 NO_OPEN_ISSUES로 끝난다 (11회)', async () => {
  const { rec, driver } = await run('algorithm', {
    BEAR: () => ({ output: { steelman: 's', evidenceRefs: ['brief:NOVA#c1'], openIssues: [], summary: 's', narrative: 'n' } }),
  });
  assert.equal(rec.state, 'COMPLETED');
  assert.equal(rec.debate.stopReason, 'NO_OPEN_ISSUES');
  assert.equal(rec.debate.roundCount, 1);
  assert.equal(rec.usage.modelCallCount, 11);
  assert.equal(calledRoles(driver).filter((r) => r === 'BULL' || r === 'BEAR').length, 2);
});

test('P0-1.4 BEAR가 BULL이 인용하지 않은 새 근거를 내지 않으면 NO_NEW_EVIDENCE로 끝난다', async () => {
  const { rec } = await run('algorithm', {
    BEAR: () => ({ output: { steelman: 's', evidenceRefs: ['brief:TARO#c1'], openIssues: ['쟁점'], summary: 's', narrative: 'n' } }),
  });
  assert.equal(rec.debate.stopReason, 'NO_NEW_EVIDENCE');
  assert.equal(rec.usage.modelCallCount, 11);
});

test('P1-1-T1 스캘핑·강제 방향 정상 작업: 경로가 명세와 같고 호출 5회, 최종 의사결정자 ACE', async () => {
  for (const mode of ['scalp', 'forced_direction'] as const) {
    const { rec, driver, d } = await run(mode);
    assert.equal(rec.state, 'COMPLETED', mode);
    assert.deepEqual(states({ record: rec, snapshot: null }), MODE_PATHS[mode], mode);
    assert.deepEqual(calledRoles(driver).slice(2), ['BLITZ', 'GUARD', 'ACE'], mode);
    assert.equal(rec.usage.modelCallCount, 5, mode);
    assert.equal(d?.finalDecisionMaker, 'ACE', mode);
    assert.equal(d?.pmDecision, null, mode);
    assert.equal(rec.debate.stopReason, null, mode);
    assert.equal(rec.outputs.blitzPlan?.author, 'BLITZ', mode);
    assert.equal(rec.outputs.proposal?.author, 'ACE', mode);
  }
});

test('P0-1-T3 토론 중 한 번 재시도하면 retryCallCount = 1이고 modelCallCount가 1 늘어난다', async () => {
  const { rec } = await run('algorithm', {
    BULL: (input, nth) => (nth === 0 ? { output: { garbage: true } } : { output: sampleOutput('BULL', input) }),
  });
  assert.equal(rec.state, 'COMPLETED');
  assert.equal(rec.usage.retryCallCount, 1);
  assert.equal(rec.usage.modelCallCount, 14);
});

test('P0-1-T4 ACE 호출 중 취소하면 ACE 호출까지 세고 이후 호출은 시작하지 않는다', async () => {
  const s = await setup('algorithm');
  const ac = new AbortController();
  const driver = autoDriver({ ACE: () => { setTimeout(() => ac.abort(), 20); return { hang: true }; } });
  await runJob(s.engine, s.job, driver, ac.signal, { sleep: noSleep });
  const rec = s.job.record;
  assert.equal(rec.state, 'CANCELLED');
  assert.equal(rec.error?.code, 'E-CANCELLED');
  assert.equal(calledRoles(driver).at(-1), 'ACE');
  assert.equal(rec.usage.modelCallCount, 4 + 4 + 1);
  assert.equal(rec.finalDecision, null); // P1-1-R4 종료 상태 중 COMPLETED만 판정이 된다
});

test('P0-1-T5 데모(fixture) 드라이버는 modelCallCount = 0으로 기록되고, 같은 검증·규칙 엔진을 거친다', async () => {
  const s = await setup('scalp');
  const snap = s.job.snapshot!;
  const responses: Partial<Record<Role, unknown[]>> = {};
  for (const role of ['TARO', 'VIBE', 'BLITZ', 'GUARD', 'ACE'] as const) responses[role] = [sampleOutput(role, buildRoleInput(snap, role))];
  await runJob(s.engine, s.job, createFixtureDriver(responses), new AbortController().signal);
  assert.equal(s.job.record.state, 'COMPLETED');
  assert.equal(s.job.record.usage.modelCallCount, 0);
  assert.equal(s.job.record.usage.calls.length, 5);
  assert.equal(s.job.record.finalDecision?.ruleEngine.verdict, 'PASS');
});

test('P0-2-T2 PM이 MODIFY로 손절가를 바꾸면 최종 손절가는 PM 값이고 modifiedFields에 stopLoss가 있다', async () => {
  let pmStop = 0;
  const { rec, d } = await run('algorithm', {
    PM: (input) => {
      const ace = input.prior!.proposal as ReturnType<typeof sampleProposal>;
      const { schemaVersion: _v, jobId: _j, author: _a, ...out } = ace as typeof ace & { schemaVersion: string; jobId: string; author: string };
      pmStop = ace.stopLoss! * 1.004; // 손절을 진입가 쪽으로 당김
      return { output: { pmDecision: 'MODIFY', modifiedFields: ['stopLoss'], reasonCodes: ['STOP_TOO_WIDE'], revisedProposal: { ...out, stopLoss: pmStop }, summary: 's', narrative: 'n' } };
    },
  });
  assert.equal(rec.state, 'COMPLETED');
  assert.equal(d?.pmDecision, 'MODIFY');
  assert.equal(d?.proposal?.stopLoss, pmStop);
  assert.equal(d?.proposal?.author, 'PM');
  assert.deepEqual(d?.modifiedFields, ['stopLoss']);
  assert.notEqual(rec.outputs.proposal?.stopLoss, pmStop); // ACE 원래 제안은 따로 남는다
  assert.equal(panelView(d!).title, 'PM 수정승인');
});

test('P0-2-R3 MODIFY인데 바뀐 필드가 없으면 스키마 오류다', async () => {
  const { rec } = await run('algorithm', {
    PM: (input) => {
      const { schemaVersion: _v, jobId: _j, author: _a, ...out } = input.prior!.proposal as Record<string, unknown>;
      return { output: { pmDecision: 'MODIFY', modifiedFields: [], reasonCodes: [], revisedProposal: out, summary: 's', narrative: 'n' } };
    },
  });
  assert.equal(rec.state, 'SCHEMA_ERROR');
  assert.equal(rec.error?.role, 'PM');
  assert.equal(rec.usage.calls.filter((c) => c.role === 'PM').length, 2); // 1회 재시도 후 실패
});

test('P0-2-T3 PM이 REJECT하면 최종 행동은 NO_TRADE이고 ACE 제안은 판정에 채택되지 않는다', async () => {
  const { rec, d } = await run('algorithm', {
    PM: () => ({ output: { pmDecision: 'REJECT', modifiedFields: [], reasonCodes: ['COMMITTEE_CONCERN'], revisedProposal: null, summary: 's', narrative: 'n' } }),
  });
  assert.equal(rec.state, 'COMPLETED');
  assert.equal(d?.status, 'NO_TRADE');
  assert.equal(d?.action, 'NO_TRADE');
  assert.equal(d?.pmDecision, 'REJECT');
  assert.equal(d?.proposal, null);
  assert.ok(d?.reasonCodes.includes('PM_REJECTED'));
  assert.equal(rec.outputs.proposal?.action, 'ENTER_LONG'); // 원래 제안은 proposals 영역용으로 보존
  assert.equal(panelView(d!).title, 'PM 기각 → 거래 없음');
});

test('P0-5-T5 unforcedAction = NO_TRADE, 확신도 80이어도 근거 부족 표기가 먼저 나온다', async () => {
  const { rec, d } = await run('forced_direction', {
    ACE: (input) => ({ output: sampleProposal(input, { unforcedAction: 'NO_TRADE', confidence: 80 }) }),
  });
  assert.equal(rec.state, 'COMPLETED');
  assert.equal(d?.resultClass, 'simulation');
  assert.equal(d?.forcedDirection, true);
  assert.equal(d?.unforcedAction, 'NO_TRADE');
  assert.equal(d?.confidence?.band, 'HIGH');
  const view = panelView(d!);
  assert.equal(view.notes[0], '근거 부족 — 강제로 고른 방향');
  assert.ok(view.badges.includes('강제 방향 시뮬레이션'));
});

test('P0-3-T7 강제 방향에서 NO_TRADE 응답은 재시도 후 SCHEMA_ERROR', async () => {
  const { rec } = await run('forced_direction', {
    ACE: (input) => ({ output: sampleProposal(input, { action: 'NO_TRADE', unforcedAction: 'NO_TRADE' }) }),
  });
  assert.equal(rec.state, 'SCHEMA_ERROR');
  assert.equal(rec.error?.code, 'E-SCHEMA');
  assert.match(rec.error!.detail, /V-ACTION|허용되지 않는 행동/);
});

test('P0-8-T1 모든 호출이 스키마 오류를 내면 알고리즘 작업은 17회 이하로 SCHEMA_ERROR 또는 BUDGET_EXCEEDED', async () => {
  const bad: Override = () => ({ output: { nope: 1 } });
  const all = Object.fromEntries(['TARO', 'DIANA', 'NOVA', 'VIBE', 'BULL', 'BEAR', 'ACE', 'RISKY', 'SAFE', 'NEUTRAL', 'PM'].map((r) => [r, bad]));
  const { rec, driver } = await run('algorithm', all);
  assert.ok(['SCHEMA_ERROR', 'BUDGET_EXCEEDED'].includes(rec.state), rec.state);
  assert.ok(driver.calls.length <= 17);
  assert.equal(rec.usage.modelCallCount, driver.calls.length);
  assert.ok(rec.usage.retryCallCount <= 4);
});

test('인증 실패는 병렬 애널리스트 호출 중이어도 FAILED(E-AUTH)로 끝나고 다음 단계로 가지 않는다', async () => {
  const { rec, driver } = await run('algorithm', { NOVA: () => ({ error: 'E-AUTH' }) });
  assert.equal(rec.state, 'FAILED');
  assert.equal(rec.error?.code, 'E-AUTH');
  assert.equal(rec.error?.role, 'NOVA');
  assert.equal(calledRoles(driver).includes('BULL'), false);
});

test('P0-4-T1 한 작업의 모든 역할 입력(파일과 모델 요청)의 snapshotId가 같다', async () => {
  const { rec, driver, root } = await run('algorithm');
  const sid = rec.snapshot!.snapshotId;
  const dir = join(root, rec.jobId, 'inputs');
  const files = readdirSync(dir);
  assert.equal(files.length, 13);
  for (const f of files) assert.equal(JSON.parse(readFileSync(join(dir, f), 'utf8')).snapshotId, sid, f);
  for (const c of driver.calls) assert.equal(parseRequestInput(c.input).snapshotId, sid, c.role);
  assert.equal(rec.finalDecision?.snapshotId, sid);
});

test('P1-10-R4 애널리스트 입력 파일에는 다른 애널리스트의 출력이 없다', async () => {
  const { rec, root } = await run('algorithm');
  for (const role of ['TARO', 'DIANA', 'NOVA', 'VIBE']) {
    const text = readFileSync(join(root, rec.jobId, 'inputs', `${role}.json`), 'utf8');
    assert.equal(text.includes(`${rec.jobId}:`), false, role);
    assert.equal(text.includes('"prior"'), false, role);
  }
  const bull = readFileSync(join(root, rec.jobId, 'inputs', 'BULL-2.json'), 'utf8');
  assert.ok(bull.includes(`${rec.jobId}:TARO`));
  assert.equal(JSON.parse(bull).prior.round, 2);
});

test('P0-4-R4 · P0-4-T2 필수 소스가 실패하면 모델 호출 없이 INSUFFICIENT_DATA로 끝난다', async () => {
  const s = await setup('scalp', 'web', { fail: ['fapi.binance.com/fapi/v1/premiumIndex', 'fapi.binance.com/fapi/v1/ticker'] });
  assert.equal(s.job.record.state, 'INSUFFICIENT_DATA');
  assert.deepEqual(states(s.job), ['QUEUED', 'COLLECTING_DATA', 'VALIDATING_DATA', 'INSUFFICIENT_DATA']);
  assert.equal(s.job.record.error?.code, 'E-DATA-REQUIRED');
  assert.equal(s.job.record.finalDecision?.status, 'INSUFFICIENT_DATA');
  assert.equal(s.job.record.finalDecision?.action, null);
  const driver = autoDriver();
  await runJob(s.engine, s.job, driver, new AbortController().signal);
  assert.equal(driver.calls.length, 0);
  assert.equal(s.job.record.usage.modelCallCount, 0);
});

test('P0-4-R5 지원하지 않는 종목은 수집 없이 UNSUPPORTED_SYMBOL로 끝난다', async () => {
  const s = await setup('scalp', 'web', { symbol: '없는종목' });
  assert.equal(s.job.record.state, 'UNSUPPORTED_SYMBOL');
  assert.deepEqual(states(s.job), ['QUEUED', 'UNSUPPORTED_SYMBOL']);
  assert.equal(s.job.record.error?.code, 'E-UNSUPPORTED-SYMBOL');
  assert.equal(s.job.snapshot, null);
});

test('종목 조회 자체가 네트워크 오류로 실패하면 작업이 QUEUED에 남지 않고 FAILED로 끝난다', async () => {
  const s = await setup('algorithm', 'web', { symbol: 'NOPE' }); // 미국 종목 형식 → 조회 요청 → 녹화 없음
  assert.equal(s.job.record.state, 'FAILED');
  assert.deepEqual(states(s.job), ['QUEUED', 'FAILED']);
  assert.equal(s.job.record.error?.code, 'E-DATA-REQUIRED');
  assert.match(s.job.record.error!.detail, /종목 조회 실패/);
});

// ── /floor 경로: 세션이 next가 알려준 역할의 출력을 submit한다 (같은 엔진, 드라이버 없음) ──

test('P1-5-T1 next가 지시하지 않은 역할의 출력은 거부되고, 통과한 출력은 다시 제출할 수 없다', async () => {
  const s = await setup('scalp', 'floor');
  const { engine, job } = s;
  const out = (role: Role) => sampleOutput(role, buildRoleInput(job.snapshot!, role));
  assert.equal(engine.submit(job, 'TARO', out('TARO')).ok, false); // next 전
  const n = engine.next(job);
  assert.equal(n.kind, 'steps');
  assert.deepEqual(n.kind === 'steps' && n.steps.map((x) => x.stepId), ['TARO', 'VIBE']);
  const r1 = engine.submit(job, 'ACE', out('ACE'));
  assert.ok(!r1.ok && r1.kind === 'rejected');
  assert.ok(engine.submit(job, 'TARO', out('TARO')).ok);
  const again = engine.submit(job, 'TARO', out('TARO'));
  assert.ok(!again.ok && again.kind === 'rejected');
  assert.equal(job.record.outputs.briefings.TARO?.briefingId, `${job.record.jobId}:TARO`);
});

test('P1-5-T2 토론 1라운드 뒤 openIssues가 비면 next가 2라운드를 건너뛰고 ACE를 지시한다', async () => {
  const s = await setup('algorithm', 'floor');
  const { engine, job } = s;
  const ids: string[] = [];
  for (;;) {
    const n = engine.next(job);
    if (n.kind !== 'steps') break;
    for (const st of n.steps) {
      ids.push(st.stepId);
      const out = st.role === 'BEAR'
        ? { steelman: 's', evidenceRefs: ['brief:NOVA#c1'], openIssues: [], summary: 's', narrative: 'n' }
        : sampleOutput(st.role, st.input);
      assert.ok(engine.submit(job, st.stepId, out).ok, st.stepId);
    }
  }
  assert.deepEqual(ids.slice(4, 7), ['BULL-1', 'BEAR-1', 'ACE']);
  assert.equal(job.record.debate.stopReason, 'NO_OPEN_ISSUES');
  const d = engine.finalize(job);
  assert.equal(job.record.state, 'COMPLETED');
  assert.equal(d?.executionBackend, 'single_session');
  assert.equal(job.record.usage.roleTurnCount, 11); // P0-1-R5
  assert.equal(job.record.usage.modelCallCount, 0);
});

test('/floor 경로도 CLI 한 번씩(openJob)으로 이어갈 수 있고, 손절이 진입가 위인 롱은 V-DIR-LONG으로 강등된다 (P0-F-T2)', async () => {
  const s = await setup('scalp', 'floor');
  const jobId = s.job.record.jobId;
  for (;;) {
    const job = s.engine.openJob(jobId); // 명령마다 새 프로세스라고 가정
    const n = s.engine.next(job);
    if (n.kind === 'finalize') {
      s.engine.finalize(s.engine.openJob(jobId));
      break;
    }
    assert.equal(n.kind, 'steps');
    if (n.kind !== 'steps') break;
    for (const st of n.steps) {
      const input = JSON.parse(readFileSync(st.inputPath, 'utf8'));
      const out = st.role === 'ACE' ? sampleProposal(input, { stopLoss: input.priceBasis.last * 1.01 }) : sampleOutput(st.role, input);
      assert.ok(s.engine.submit(s.engine.openJob(jobId), st.stepId, out).ok, st.stepId);
    }
  }
  const rec = s.store.load(jobId);
  assert.equal(rec.state, 'COMPLETED');
  assert.equal(rec.finalDecision?.action, 'NO_TRADE');
  assert.equal(rec.finalDecision?.bias, 'BULLISH');
  assert.ok(rec.finalDecision?.ruleEngine.violations.some((v) => v.code === 'V-DIR-LONG'));
  assert.equal(rec.finalDecision?.ruleEngine.verdict, 'DOWNGRADED');
});

test('/floor 제출이 스키마 오류면 한 번 재시도할 수 있고, 두 번째도 실패하면 SCHEMA_ERROR', async () => {
  const s = await setup('scalp', 'floor');
  const { engine, job } = s;
  engine.next(job);
  const first = engine.submit(job, 'TARO', { claims: [] });
  assert.ok(!first.ok && first.kind === 'schema' && !first.terminal);
  assert.match(first.ok ? '' : first.kind === 'schema' ? first.summary : '', /claims/);
  const second = engine.submit(job, 'TARO', { claims: [] });
  assert.ok(!second.ok && second.kind === 'schema' && second.terminal);
  assert.equal(job.record.state, 'SCHEMA_ERROR');
  assert.equal(job.record.usage.retryCallCount, 1);
  assert.equal(job.record.usage.roleTurnCount, 2);
});

test('스냅샷 파일이 바뀌면 작업을 열 때 해시 불일치로 거부한다 (P0-4-R1)', async () => {
  const s = await setup('scalp', 'floor');
  const p = s.job.record.snapshot!.path;
  const snap = JSON.parse(readFileSync(p, 'utf8'));
  snap.derived.indicators.rsi14 = 99;
  writeFileSync(p, JSON.stringify(snap));
  assert.throws(() => s.engine.openJob(s.job.record.jobId), /해시/);
});

test('P1-1-T2 재시작 시 진행 중 작업은 INTERRUPTED가 되고, 기록된 claude 프로세스를 종료하며, 판정이 남지 않는다', async () => {
  const s = await setup('algorithm');
  const { engine, job } = s;
  // RISK_REVIEW까지 진행
  const driver = autoDriver({ RISKY: () => ({ hang: true }) });
  const ac = new AbortController();
  const running = runJob(engine, job, driver, ac.signal, { sleep: noSleep });
  while (job.record.state !== 'RISK_REVIEW') await new Promise((r) => setTimeout(r, 5));
  // 서버가 강제 종료된 것처럼: 남은 하위 프로세스 하나를 작업 기록에 등록해 둔다
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { detached: true, stdio: 'ignore' });
  engine.trackPid(job, child.pid!);
  const exited = new Promise((r) => child.on('exit', r));
  const snapshotOnDisk = s.store.load(job.record.jobId);
  assert.equal(snapshotOnDisk.state, 'RISK_REVIEW');

  // 새 서버 프로세스의 엔진 (같은 저장소)
  const killed: number[] = [];
  const ids = engine.recoverInterrupted((pid) => { killed.push(pid); process.kill(-pid, 'SIGKILL'); });
  assert.deepEqual(ids, [job.record.jobId]);
  assert.deepEqual(killed, [child.pid]);
  await exited;
  const rec = s.store.load(job.record.jobId);
  assert.equal(rec.state, 'INTERRUPTED');
  assert.equal(rec.error?.code, 'E-INTERRUPTED');
  assert.deepEqual(rec.pids, []);
  assert.equal(rec.finalDecision, null);
  assert.equal(engine.recoverInterrupted(() => {}).length, 0); // 이미 종료된 작업은 다시 건드리지 않는다
  ac.abort();
  await running.catch(() => {}); // 옛 엔진의 쓰기는 종료 상태 보호로 거부된다
  assert.equal(s.store.load(job.record.jobId).state, 'INTERRUPTED');
});

test('녹화된 모든 종목·모드로 정상 작업이 끝나고, 입력이 상한 안에 들어가며 근거 참조가 확인된다', async () => {
  for (const name of ['btc-algorithm', 'btc-scalp', 'hynix-algorithm', 'hynix-scalp', 'tsla-algorithm']) {
    const r = replayAcquirer(name);
    const t = tempEngine(r.at);
    const job = await t.engine.createJob({ idempotencyKey: name, mode: r.mode, symbolInput: r.symbol, interface: 'web' }, r.acquirer);
    const driver = autoDriver();
    await runJob(t.engine, job, driver, new AbortController().signal, { sleep: noSleep });
    const d = job.record.finalDecision;
    assert.equal(job.record.state, 'COMPLETED', `${name}: ${job.record.error?.detail}`);
    assert.equal(d?.ruleEngine.verdict, 'PASS', `${name}: ${JSON.stringify(d?.ruleEngine)}`);
    assert.deepEqual(d?.ruleEngine.warnings.filter((w) => w.startsWith('근거 확인 불가')), [], name);
    for (const c of driver.calls) assert.ok(c.systemPrompt.length + c.input.length <= 20_000, `${name} ${c.role} ${c.input.length}`);
  }
});
