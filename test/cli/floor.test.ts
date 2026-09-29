import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT, main, parseMode, type CliDeps } from '../../src/cli/floor.ts';
import type { RoleInput } from '../../src/core/data/project.ts';
import { budgetFor } from '../../src/core/job/budget.ts';
import type { Mode, Role } from '../../src/core/schema/types.ts';
import { replayAcquirer } from '../data-helpers.ts';
import { autoDriver, sampleOutput, sampleProposal } from '../job-helpers.ts';

const CLI = fileURLToPath(new URL('../../src/cli/floor.ts', import.meta.url));
const FIXTURE: Record<Mode, string> = { algorithm: 'btc-algorithm', scalp: 'btc-scalp', forced_direction: 'btc-scalp' };

interface Harness {
  root: string;
  clock: { t: number };
  run(...argv: string[]): Promise<{ code: number; out: string; err: string; json: any }>;
}

function harness(mode: Mode = 'scalp', over: Partial<CliDeps> & { fail?: string[]; symbol?: string } = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), 'floor-cli-'));
  const rec = replayAcquirer(FIXTURE[mode]);
  const clock = { t: rec.at.getTime() };
  return {
    root, clock,
    async run(...argv) {
      let out = '';
      let err = '';
      const code = await main(argv, {
        root, env: {}, now: () => new Date(clock.t), tzOffsetMinutes: 540,
        out: (s) => { out += s + '\n'; }, err: (s) => { err += s + '\n'; },
        acquirer: () => replayAcquirer(FIXTURE[mode], { ...(over.fail ? { fail: over.fail } : {}), ...(over.symbol ? { symbol: over.symbol } : {}) }).acquirer,
        driver: () => autoDriver(),
        checkClaude: async () => ({ ok: true }),
        claudeVersion: async () => '2.1.284 (Claude Code)',
        ...over,
      });
      let json: any = null;
      try { json = JSON.parse(out); } catch { /* 사람용 출력 */ }
      return { code, out, err, json };
    },
  };
}

/** /floor 세션 흉내: next가 알려 준 입력 파일을 읽고 outputs/<단계>.json에 써서 submit */
async function sessionTurns(h: Harness, jobId: string, outputFor: (role: Role, input: RoleInput) => unknown = sampleOutput): Promise<string[]> {
  const done: string[] = [];
  for (;;) {
    const n = await h.run('next', '--job', jobId);
    if (n.code === EXIT.NO_MORE_STEPS) return done;
    assert.equal(n.code, EXIT.OK, n.err);
    for (const s of n.json.steps) {
      assert.ok(existsSync(s.promptPath) && existsSync(s.schemaPath), s.stepId);
      const input = JSON.parse(readFileSync(s.inputPath, 'utf8')) as RoleInput;
      writeFileSync(s.outputPath, JSON.stringify(outputFor(s.role, input)));
      const r = await h.run('submit', '--job', jobId, '--role', s.stepId, '--file', s.outputPath);
      assert.equal(r.code, EXIT.OK, r.out + r.err);
      done.push(s.stepId);
    }
  }
}

test('모드 인자는 정해진 이름과 한글 별칭만 받는다', () => {
  assert.equal(parseMode('scalp'), 'scalp');
  assert.equal(parseMode('공격'), 'forced_direction');
  assert.equal(parseMode('알고리즘'), 'algorithm');
  assert.equal(parseMode('scalp; rm -rf /'), null);
});

test('P1-5.1 /floor 전체 흐름: snapshot 0 → next/submit 0 → next 10 → finalize 0 (리포트 경로)', async () => {
  const h = harness('scalp');
  const s = await h.run('snapshot', '--symbol', 'BTC', '--mode', 'scalp');
  assert.equal(s.code, EXIT.OK, s.err);
  assert.equal(s.json.executionBackend, 'single_session');
  assert.ok(existsSync(s.json.snapshotPath));
  assert.deepEqual(s.json.plan.map((p: { stepId: string }) => p.stepId), ['TARO', 'VIBE', 'BLITZ', 'GUARD', 'ACE']);
  const jobId = s.json.jobId;
  const steps = await sessionTurns(h, jobId);
  assert.deepEqual(steps, ['TARO', 'VIBE', 'BLITZ', 'GUARD', 'ACE']);
  const f = await h.run('finalize', '--job', jobId);
  assert.equal(f.code, EXIT.OK, f.err);
  assert.equal(f.json.state, 'COMPLETED');
  assert.ok(existsSync(f.json.report.json) && existsSync(f.json.report.md));
  const rep = JSON.parse(readFileSync(f.json.report.json, 'utf8'));
  assert.equal(rep.versions.claudeCli, '2.1.284 (Claude Code)');
  assert.equal(rep.interface, 'floor');
  const again = await h.run('next', '--job', jobId);
  assert.equal(again.code, EXIT.NO_MORE_STEPS);
  assert.equal(again.json.state, 'COMPLETED');
});

test('P1-5.1 snapshot 종료 코드: 지원하지 않는 종목 2, 필수 데이터 부족 3', async () => {
  const u = await harness('scalp', { symbol: 'NOTASYMBOL' }).run('snapshot', '--symbol', 'NOTASYMBOL', '--mode', 'scalp');
  assert.equal(u.code, EXIT.UNSUPPORTED_SYMBOL);
  assert.equal(u.json.state, 'UNSUPPORTED_SYMBOL');
  assert.equal(u.json.error.code, 'E-UNSUPPORTED-SYMBOL');
  const i = await harness('scalp', { fail: ['fapi.binance.com'] }).run('snapshot', '--symbol', 'BTC', '--mode', 'scalp');
  assert.equal(i.code, EXIT.INSUFFICIENT_DATA);
  assert.equal(i.json.state, 'INSUFFICIENT_DATA');
  const bad = await harness().run('snapshot', '--symbol', 'BTC', '--mode', 'yolo');
  assert.equal(bad.code, EXIT.OTHER);
  assert.match(bad.err, /모드가 잘못/);
});

test('P1-5-T1 next가 지시하지 않은 역할의 출력은 submit이 거부하고, 스키마 오류는 종료 코드 4', async () => {
  const h = harness('scalp');
  const s = await h.run('snapshot', '--symbol', 'BTC', '--mode', 'scalp');
  const jobId = s.json.jobId;
  const n = await h.run('next', '--job', jobId);
  const dir = join(h.root, 'jobs', jobId, 'outputs');
  const taro = n.json.steps.find((x: { stepId: string }) => x.stepId === 'TARO');
  const input = JSON.parse(readFileSync(taro.inputPath, 'utf8'));
  writeFileSync(join(dir, 'ACE.json'), JSON.stringify(sampleOutput('TARO', input)));
  const r = await h.run('submit', '--job', jobId, '--role', 'ACE', '--file', join(dir, 'ACE.json'));
  assert.equal(r.code, EXIT.OTHER);
  assert.equal(r.json.kind, 'rejected');
  writeFileSync(taro.outputPath, '{"claims": []');
  const bad = await h.run('submit', '--job', jobId, '--role', 'TARO', '--file', taro.outputPath);
  assert.equal(bad.code, EXIT.SCHEMA_ERROR);
  assert.equal(bad.json.terminal, false);
  // 작업 디렉터리 밖의 파일은 제출할 수 없다 (P1-5-R3)
  const outside = join(h.root, 'x.json');
  writeFileSync(outside, JSON.stringify(sampleOutput('TARO', input)));
  const o = await h.run('submit', '--job', jobId, '--role', 'TARO', '--file', outside);
  assert.equal(o.code, EXIT.OTHER);
  assert.match(o.err, /작업 디렉터리 밖/);
  // 남은 단계가 있으면 finalize는 1
  const f = await h.run('finalize', '--job', jobId);
  assert.equal(f.code, EXIT.OTHER);
  assert.match(f.err, /남은 단계/);
});

test('P1-5-T2 토론 1라운드 뒤 openIssues가 비면 next가 2라운드를 건너뛰고 ACE를 지시한다', async () => {
  const h = harness('algorithm');
  const s = await h.run('snapshot', 'BTC', 'algorithm');
  assert.equal(s.code, EXIT.OK, s.err);
  const steps = await sessionTurns(h, s.json.jobId, (role, input) =>
    role === 'BEAR' ? { steelman: 's', evidenceRefs: ['brief:NOVA#c1'], openIssues: [], summary: 's', narrative: 'n' } : sampleOutput(role, input));
  assert.deepEqual(steps.slice(4), ['BULL-1', 'BEAR-1', 'ACE', 'RISKY', 'SAFE', 'NEUTRAL', 'PM']);
  const f = await h.run('finalize', '--job', s.json.jobId);
  assert.equal(f.code, EXIT.OK, f.err);
});

test('P0-F-T2 세션 출력에서 롱 손절가를 진입가 위로 조작하면 finalize가 NO_TRADE + V-DIR-LONG', async () => {
  const h = harness('scalp');
  const s = await h.run('snapshot', '--symbol', 'BTC', '--mode', 'scalp');
  await sessionTurns(h, s.json.jobId, (role, input) => role === 'ACE' ? sampleProposal(input, { stopLoss: input.priceBasis!.last! * 1.01 }) : sampleOutput(role, input));
  const f = await h.run('finalize', '--job', s.json.jobId);
  assert.equal(f.code, EXIT.OK);
  assert.equal(f.json.decision.action, 'NO_TRADE');
  assert.ok(f.json.decision.violations.includes('V-DIR-LONG'));
});

test('P1-5-T3 finalize 전에 세션이 끝난 작업은 다음 코어 명령에서 INTERRUPTED가 되고 리포트가 없다', async () => {
  const h = harness('scalp');
  const a = await h.run('snapshot', '--symbol', 'BTC', '--mode', 'scalp');
  const n = await h.run('next', '--job', a.json.jobId);
  assert.equal(n.code, EXIT.OK);
  // 세션 종료: 아무도 이어가지 않은 채 시간 상한이 지난다
  h.clock.t += (budgetFor('scalp').maxDurationSeconds + 1) * 1000;
  await h.run('snapshot', '--symbol', 'BTC', '--mode', 'scalp'); // 다음 코어 명령 (녹화 데이터는 이 시각에 만료라 결과는 상관없다)
  const rec = JSON.parse(readFileSync(join(h.root, 'jobs', a.json.jobId, 'job.json'), 'utf8'));
  assert.equal(rec.state, 'INTERRUPTED');
  assert.equal(rec.finalDecision, null);
  const f = await h.run('finalize', '--job', a.json.jobId);
  assert.equal(f.code, EXIT.OTHER);
  assert.equal(f.json.state, 'INTERRUPTED');
  assert.equal(existsSync(join(h.root, 'reports')) ? readdirSync(join(h.root, 'reports')).length : 0, 0);
});

test('P0-F-R5 · P1-5.1 스냅샷 뒤 시간 상한이 지나 finalize하면 BUDGET_EXCEEDED로 종료 코드 5', async () => {
  const h = harness('scalp');
  const s = await h.run('snapshot', '--symbol', 'BTC', '--mode', 'scalp');
  await sessionTurns(h, s.json.jobId);
  h.clock.t += (budgetFor('scalp').maxDurationSeconds + 1) * 1000;
  const f = await h.run('finalize', '--job', s.json.jobId);
  assert.equal(f.code, EXIT.BUDGET_EXCEEDED);
  assert.equal(f.json.state, 'BUDGET_EXCEEDED');
  assert.equal(f.json.report, null);
});

test('analyze: 드라이버로 끝까지 실행하고 리포트를 저장한다 (종료 코드 0)', async () => {
  const h = harness('algorithm');
  const r = await h.run('analyze', 'BTC', 'algorithm', '--json');
  assert.equal(r.code, EXIT.OK, r.err);
  assert.equal(r.json.state, 'COMPLETED');
  assert.equal(r.json.usage.modelCallCount, 13);
  assert.ok(existsSync(r.json.report.json));
  assert.match(r.err, /→ PM/);
  const human = await h.run('analyze', 'BTC', 'algorithm');
  assert.equal(human.code, EXIT.OK);
  assert.match(human.out, /PM 승인/);
  assert.match(human.out, /리포트 .*\.md/);
});

test('P1-8-T3 · P1-8-R6 analyze: 시계 오차가 크면 E-CLOCK으로 차단하고 진단 안내를 붙인다', async () => {
  const h = harness('scalp', { acquirer: () => ({ ...replayAcquirer('btc-scalp').acquirer, clockSkewMs: () => 120_000 }) });
  const r = await h.run('analyze', 'BTC', 'scalp', '--json');
  assert.equal(r.code, EXIT.OTHER);
  assert.equal(r.json.error.code, 'E-CLOCK');
  assert.match(r.json.error.hint, /doctor/);
  assert.equal(r.json.usage.modelCallCount, 0);
});

test('P1-8-R6 analyze: Claude 미로그인이면 작업을 만들기 전에 멈추고 진단 안내를 보여준다', async () => {
  const h = harness('scalp', { checkClaude: async () => ({ ok: false, code: 'E-AUTH', detail: '로그인 안 됨' }) });
  const r = await h.run('analyze', 'BTC', 'scalp');
  assert.equal(r.code, EXIT.OTHER);
  assert.match(r.err, /E-AUTH/);
  assert.match(r.err, /doctor/);
  assert.equal(existsSync(join(h.root, 'jobs')) ? readdirSync(join(h.root, 'jobs')).length : 0, 0);
});

test('P1-8-T1 analyze --demo: Claude·네트워크 없이 재생하고 _DEMO 리포트를 남긴다 (별도 프로세스)', () => {
  const home = mkdtempSync(join(tmpdir(), 'floor-home-'));
  const r = spawnSync(process.execPath, [CLI, 'analyze', 'BTC', 'scalp', '--demo', '--json'], {
    encoding: 'utf8', env: { PATH: process.env.PATH ?? '', FLOOR_HOME: home }, timeout: 60_000,
  });
  assert.equal(r.status, EXIT.OK, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.state, 'COMPLETED');
  assert.equal(out.demo, true);
  assert.equal(out.usage.modelCallCount, 0);
  assert.match(out.report.json, /_DEMO\.json$/);
  assert.ok(out.report.json.startsWith(home));
  const wrong = spawnSync(process.execPath, [CLI, 'analyze', 'TSLA', 'scalp', '--demo'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', FLOOR_HOME: home } });
  assert.equal(wrong.status, EXIT.OTHER);
  assert.match(wrong.stderr, /데모는 BTC/);
});

test('doctor: 진단 결과를 JSON으로 내고 오류가 있으면 종료 코드 1', async () => {
  const net = { kind: 'fixture' as const, async get(url: string) { return { url, status: 200, body: '{}', date: new Date().toUTCString(), fetchedAt: new Date().toISOString() }; } };
  const h = harness('scalp', { executable: null, net, now: () => new Date() });
  const r = await h.run('doctor', '--json');
  assert.equal(r.code, EXIT.OTHER);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.checks.find((c: { id: string }) => c.id === 'claude-cli').code, 'E-CLI-MISSING');
  const human = await h.run('doctor');
  assert.match(human.out, /✗ Claude CLI/);
});

test('알 수 없는 명령·옵션은 종료 코드 1과 사용법', async () => {
  const h = harness();
  assert.equal((await h.run('rm')).code, EXIT.OTHER);
  const r = await h.run('next', '--job', '../../etc');
  assert.equal(r.code, EXIT.OTHER);
  const o = await h.run('snapshot', '--evil');
  assert.equal(o.code, EXIT.OTHER);
  assert.match(o.err, /사용법/);
});
