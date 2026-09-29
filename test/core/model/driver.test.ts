import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildArgs, buildChildEnv, createClaudeCliDriver, findClaudeExecutable, parseCliOutput, type ClaudeExecutable,
} from '../../../src/core/model/claude-cli.ts';
import type { ModelRequest } from '../../../src/core/model/driver.ts';
import { classifyCliFailure } from '../../../src/core/model/errors.ts';

const fake: ClaudeExecutable = {
  command: process.execPath, prefixArgs: [fileURLToPath(new URL('../../fixtures/fake-claude.mjs', import.meta.url))], kind: 'node-script',
};
const req = (input: string, over: Partial<ModelRequest> = {}): ModelRequest => ({
  role: 'TARO', systemPrompt: 'system', input, jsonSchema: { type: 'object' }, model: 'haiku', timeoutMs: 10_000, maxOutputChars: 6000, ...over,
});
const never = new AbortController().signal;

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

test('정상 응답: structured_output, 실제 모델 ID, 사용량을 읽는다', async () => {
  const r = await createClaudeCliDriver({ executable: fake }).call(req('#MODE=ok'), never);
  assert.ok(r.ok);
  assert.deepEqual(r.output, { hello: 'world' });
  assert.equal(r.modelId, 'claude-fake-1'); // P1-6-R4
  assert.equal(r.usage.inputTokens, 1200);
});

test('P1-7-T6, P1-7-R7 도구를 모두 끄고 빈 작업 디렉터리에서 셸 없이 실행한다', async () => {
  const r = await createClaudeCliDriver({ executable: fake }).call(req('#MODE=env'), never);
  assert.ok(r.ok);
  const o = r.output as { cwd: string; cwdEntries: string[]; args: string[] };
  assert.deepEqual(o.cwdEntries, []);
  assert.equal(o.cwd.startsWith(process.cwd()), false);
  const i = o.args.indexOf('--tools');
  assert.equal(o.args[i + 1], '');
  assert.ok(o.args.includes('--safe-mode'));
  assert.ok(o.args.includes('--no-session-persistence'));
  // 입력 데이터는 인자가 아니라 표준 입력으로 (P1-7-R3)
  assert.equal(o.args.some((a) => a.includes('#MODE')), false);
  assert.deepEqual(buildArgs({ model: 'm', jsonSchema: { a: 1 } }, '/p.md').slice(0, 4), ['-p', '--safe-mode', '--tools', '']);
  assert.deepEqual(buildArgs({ model: 'm', jsonSchema: {}, effort: 'low' }, '/p.md').slice(-2), ['--effort', 'low']);
});

test('P1-7-T4 ANTHROPIC_API_KEY는 기본적으로 하위 프로세스에 넘기지 않는다', async () => {
  const env = { ...process.env, ANTHROPIC_API_KEY: 'sk-ant-test', SECRET_TOKEN: 'x' };
  const r = await createClaudeCliDriver({ executable: fake, env }).call(req('#MODE=env'), never);
  assert.ok(r.ok);
  const keys = (r.output as { env: string[] }).env;
  assert.equal(keys.includes('ANTHROPIC_API_KEY'), false);
  assert.equal(keys.includes('SECRET_TOKEN'), false);
  assert.ok(keys.includes('PATH'));
  assert.equal(buildChildEnv({ ...env, FLOOR_USE_API_KEY: '1' }).ANTHROPIC_API_KEY, 'sk-ant-test'); // 명시적으로 켠 경우만
});

test('인증 실패는 E-AUTH, 사용량 한도는 E-QUOTA, 알 수 없는 비정상 종료는 E-CLI-CRASH', async () => {
  const d = createClaudeCliDriver({ executable: fake });
  const auth = await d.call(req('#MODE=auth'), never);
  assert.ok(!auth.ok && auth.code === 'E-AUTH');
  const quota = await d.call(req('#MODE=quota'), never);
  assert.ok(!quota.ok && quota.code === 'E-QUOTA');
  const crash = await d.call(req('#MODE=garbage'), never);
  assert.ok(!crash.ok && crash.code === 'E-CLI-CRASH');
  assert.equal(classifyCliFailure('Not logged in · Please run /login', null), 'E-AUTH');
  assert.equal(classifyCliFailure('API Error: 529 Overloaded', null), 'E-CLI-CRASH');
});

test('출력 문자 수 상한을 넘으면 E-SCHEMA (P0-8 maxOutputChars)', async () => {
  const r = await createClaudeCliDriver({ executable: fake }).call(req('#MODE=long'), never);
  assert.ok(!r.ok && r.code === 'E-SCHEMA');
});

test('P0-8-T3 취소하면 5초 안에 하위·손자 프로세스가 모두 사라진다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'floor-test-'));
  const pidFile = join(dir, 'pids.json');
  const ac = new AbortController();
  const d = createClaudeCliDriver({ executable: fake });
  const pending = d.call(req(`#MODE=hang #PIDFILE=${pidFile}`), ac.signal);
  for (let i = 0; i < 50 && !existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 100));
  const { child, grandchild } = JSON.parse(readFileSync(pidFile, 'utf8'));
  assert.ok(alive(child) && alive(grandchild));
  const t0 = Date.now();
  ac.abort();
  const r = await pending;
  assert.ok(!r.ok && r.code === 'E-CANCELLED');
  assert.ok(Date.now() - t0 < 5000);
  assert.equal(alive(child), false);
  assert.equal(alive(grandchild), false);
});

test('호출 시간 제한을 넘기면 프로세스를 끝내고 E-TIMEOUT', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'floor-test-'));
  const pidFile = join(dir, 'pids.json');
  const r = await createClaudeCliDriver({ executable: fake }).call(req(`#MODE=hang #PIDFILE=${pidFile}`, { timeoutMs: 1500 }), never);
  assert.ok(!r.ok && r.code === 'E-TIMEOUT');
  const { grandchild } = JSON.parse(readFileSync(pidFile, 'utf8'));
  assert.equal(alive(grandchild), false);
});

test('실행 파일이 없으면 E-CLI-MISSING (호출 시작 전)', async () => {
  const r = await createClaudeCliDriver({ executable: null }).call(req('x'), never);
  assert.ok(!r.ok && r.code === 'E-CLI-MISSING');
});

test('P1-7-R4 실행 파일 탐색: 네이티브 우선, Windows npm 설치는 cli.js를 Node로 직접 실행', () => {
  const dir = mkdtempSync(join(tmpdir(), 'floor-exe-'));
  const bin = join(dir, 'bin');
  mkdirSync(join(bin, 'node_modules', '@anthropic-ai', 'claude-code'), { recursive: true });
  writeFileSync(join(bin, 'claude.cmd'), '@echo off');
  writeFileSync(join(bin, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'), '');
  const win = findClaudeExecutable({ PATH: bin, USERPROFILE: dir }, 'win32');
  assert.equal(win?.kind, 'node-script');
  assert.equal(win?.command, process.execPath); // cmd.exe를 거치지 않음
  writeFileSync(join(bin, 'claude.exe'), '');
  assert.equal(findClaudeExecutable({ PATH: bin, USERPROFILE: dir }, 'win32')?.kind, 'native');
  assert.equal(findClaudeExecutable({ PATH: join(dir, 'none'), HOME: dir }, 'darwin'), null);
});

test('parseCliOutput: 스키마 강제 출력이 없으면 result 문자열을 쓴다', () => {
  const r = parseCliOutput(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '{"a":1}' }), '', 0, { role: 'ACE', maxOutputChars: 100 }, 5);
  assert.ok(r.ok && r.output === '{"a":1}' && r.modelId === 'unknown');
});
