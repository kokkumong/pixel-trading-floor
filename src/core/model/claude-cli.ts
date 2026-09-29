// claude -p 하위 프로세스 실행 (P1 명세 7.2, P0 명세 8.4~8.5).
// 셸 없이 실행 파일 + 인자 배열로 실행하고, 입력은 표준 입력으로 넘긴다. 도구는 모두 끄고 빈 작업 디렉터리에서 실행한다.
import { spawn, execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { ModelDriver, ModelRequest, ModelResult } from './driver.ts';
import { classifyCliFailure } from './errors.ts';

/** 실행 방법: 실행 파일 직접, 또는 npm 설치(.cmd)일 때 node + cli.js (cmd.exe를 거치지 않음) */
export interface ClaudeExecutable {
  command: string;
  prefixArgs: string[];
  kind: 'native' | 'node-script';
}

/**
 * P1-7-R4: 실행 파일(.exe, 네이티브 설치)을 먼저 찾는다. Windows npm 설치로 .cmd만 있으면
 * 옆의 node_modules/@anthropic-ai/claude-code/cli.js를 현재 Node로 직접 실행한다. 둘 다 없으면 null (E-CLI-MISSING).
 */
export function findClaudeExecutable(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): ClaudeExecutable | null {
  if (env.FLOOR_CLAUDE_PATH && existsSync(env.FLOOR_CLAUDE_PATH)) return { command: env.FLOOR_CLAUDE_PATH, prefixArgs: [], kind: 'native' };
  const home = env.HOME ?? env.USERPROFILE ?? '';
  const dirs = [...(env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean), join(home, '.local', 'bin'), join(home, '.claude', 'local')];
  const win = platform === 'win32';
  for (const d of dirs) {
    const exe = join(d, win ? 'claude.exe' : 'claude');
    if (existsSync(exe)) return { command: exe, prefixArgs: [], kind: 'native' };
  }
  if (win) {
    for (const d of dirs) {
      if (!existsSync(join(d, 'claude.cmd'))) continue;
      const cli = join(d, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
      if (existsSync(cli)) return { command: process.execPath, prefixArgs: [cli], kind: 'node-script' };
    }
  }
  return null;
}

/** P1-7-R5, R6: CLI 동작에 필요한 환경변수만. ANTHROPIC_API_KEY는 FLOOR_USE_API_KEY=1일 때만 */
const ENV_ALLOW = [
  'PATH', 'Path', 'PATHEXT', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TERM',
  'SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'HOMEDRIVE', 'HOMEPATH',
  'CLAUDE_CONFIG_DIR', 'NODE_EXTRA_CA_CERTS', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy',
  'XDG_CONFIG_HOME', 'XDG_RUNTIME_DIR',
];

export function buildChildEnv(src: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ENV_ALLOW) if (src[k] !== undefined) out[k] = src[k]!;
  if (src.FLOOR_USE_API_KEY === '1' && src.ANTHROPIC_API_KEY) out.ANTHROPIC_API_KEY = src.ANTHROPIC_API_KEY;
  out.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  return out;
}

export function buildArgs(req: Pick<ModelRequest, 'model' | 'jsonSchema' | 'effort'>, systemPromptFile: string): string[] {
  return [
    '-p', '--safe-mode', '--tools', '', '--no-session-persistence', '--output-format', 'json',
    '--model', req.model, '--system-prompt-file', systemPromptFile, '--json-schema', JSON.stringify(req.jsonSchema),
    ...(req.effort ? ['--effort', req.effort] : []),
  ];
}

/** 프로세스 트리 종료. POSIX는 프로세스 그룹, Windows는 taskkill /T /F. 종료를 확인한 뒤 돌아온다 (P0-8-R6) */
export async function killTree(pid: number, exited: Promise<unknown>, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (platform === 'win32') {
    await new Promise<void>((res) => execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => res()));
  } else {
    try { process.kill(-pid, 'SIGTERM'); } catch { /* 이미 종료 */ }
    const forced = setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch { /* 이미 종료 */ } }, 2000);
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    clearTimeout(forced);
    try { process.kill(-pid, 'SIGKILL'); } catch { /* 그룹 전체 종료 확인 */ }
    return;
  }
  await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
}

const MAX_STDOUT_BYTES = 2 * 1024 * 1024;

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError: string | null;
}

/**
 * 짧은 claude 하위 명령(--version, auth status) 실행. 셸 없이, 허용 목록 환경변수로, 표준 입력 없이 실행하고
 * 시간 제한을 넘기면 프로세스 트리를 종료한다 (인증 실패 시 무기한 대기하는 경우 대비)
 */
export async function runClaudeCommand(exe: ClaudeExecutable, args: string[], opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<CommandResult> {
  const child = spawn(exe.command, [...exe.prefixArgs, ...args], {
    cwd: tmpdir(), env: buildChildEnv(opts.env ?? process.env), shell: false, windowsHide: true,
    detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (d: string) => { if (stdout.length < 100_000) stdout += d; });
  child.stderr.setEncoding('utf8').on('data', (d: string) => { if (stderr.length < 20_000) stderr += d; });
  const exited = new Promise<{ code: number | null; spawnError: string | null }>((res) => {
    child.on('exit', (code) => res({ code, spawnError: null }));
    child.on('error', (e) => res({ code: null, spawnError: e.message }));
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (child.pid !== undefined) void killTree(child.pid, exited);
  }, opts.timeoutMs ?? 15_000);
  const { code, spawnError } = await exited;
  clearTimeout(timer);
  return { code, stdout, stderr, timedOut, spawnError };
}

export interface CliDriverOptions {
  executable?: ClaudeExecutable | null;
  env?: NodeJS.ProcessEnv;
  /** 작업별 디렉터리 (빈 cwd와 프롬프트 파일을 둔다). 없으면 임시 디렉터리를 만든다 */
  workRoot?: string;
  /** 실행 중인 하위 프로세스 PID 알림 (작업 기록·재시작 정리용, P1-1-R5) */
  onSpawn?: (pid: number) => void;
  onExit?: (pid: number) => void;
}

export function createClaudeCliDriver(opts: CliDriverOptions = {}): ModelDriver {
  const exe = opts.executable === undefined ? findClaudeExecutable(opts.env) : opts.executable;
  const env = buildChildEnv(opts.env ?? process.env);
  const root = opts.workRoot ?? mkdtempSync(join(tmpdir(), 'floor-'));
  const cwd = join(root, 'cwd');
  const promptDir = join(root, 'prompts');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(promptDir, { recursive: true });
  let seq = 0;

  return {
    kind: 'claude-cli',
    countsAsModelCall: true,
    async call(req, signal): Promise<ModelResult> {
      const started = Date.now();
      const took = () => Date.now() - started;
      if (!exe) return { ok: false, code: 'E-CLI-MISSING', detail: 'claude 실행 파일 없음', durationMs: 0 };
      if (signal.aborted) return { ok: false, code: 'E-CANCELLED', detail: '시작 전 취소', durationMs: 0 };

      const promptFile = join(promptDir, `${String(++seq).padStart(3, '0')}-${req.role}.md`);
      writeFileSync(promptFile, req.systemPrompt, 'utf8');
      const child = spawn(exe.command, [...exe.prefixArgs, ...buildArgs(req, promptFile)], {
        cwd, env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
      });
      const pid = child.pid;
      if (pid !== undefined) opts.onSpawn?.(pid);

      let stdout = '';
      let stderr = '';
      let overflow = false;
      child.stdout.setEncoding('utf8').on('data', (d: string) => {
        if (stdout.length + d.length > MAX_STDOUT_BYTES) overflow = true;
        else stdout += d;
      });
      child.stderr.setEncoding('utf8').on('data', (d: string) => { if (stderr.length < 20_000) stderr += d; });
      child.stdin.on('error', () => { /* 프로세스가 먼저 끝난 경우 */ });
      child.stdin.end(req.input, 'utf8');

      const exited = new Promise<{ code: number | null; spawnError?: Error }>((res) => {
        child.on('exit', (code) => res({ code }));
        child.on('error', (e) => res({ code: null, spawnError: e }));
      });

      let stopReason: 'timeout' | 'cancel' | null = null;
      const stop = async (why: 'timeout' | 'cancel') => {
        if (stopReason) return;
        stopReason = why;
        if (pid !== undefined) await killTree(pid, exited);
      };
      const timer = setTimeout(() => void stop('timeout'), req.timeoutMs);
      const onAbort = () => void stop('cancel');
      signal.addEventListener('abort', onAbort, { once: true });

      const { code, spawnError } = await exited;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      if (stopReason && pid !== undefined) await killTree(pid, exited); // 종료 확인 뒤 상태 확정
      if (pid !== undefined) opts.onExit?.(pid);
      try { rmSync(promptFile, { force: true }); } catch { /* 정리 실패는 무시 */ }

      if (stopReason === 'cancel') return { ok: false, code: 'E-CANCELLED', detail: `${req.role} 호출 중 취소`, durationMs: took() };
      if (stopReason === 'timeout') return { ok: false, code: 'E-TIMEOUT', detail: `${req.role} ${Math.round(req.timeoutMs / 1000)}초 초과`, durationMs: took() };
      if (spawnError) return { ok: false, code: 'E-CLI-MISSING', detail: spawnError.message, durationMs: took() };
      if (overflow) return { ok: false, code: 'E-SCHEMA', detail: '출력이 너무 김', durationMs: took() };
      return parseCliOutput(stdout, stderr, code, req, took());
    },
  };
}

/** claude -p --output-format json 결과 해석 */
export function parseCliOutput(stdout: string, stderr: string, exitCode: number | null, req: Pick<ModelRequest, 'role' | 'maxOutputChars'>, durationMs: number): ModelResult {
  let env: any;
  try {
    env = JSON.parse(stdout.trim());
  } catch {
    const text = `${stderr}\n${stdout}`.slice(0, 2000);
    return { ok: false, code: classifyCliFailure(text, null), detail: firstLine(text) || `종료 코드 ${exitCode}`, durationMs };
  }
  const apiStatus = typeof env.api_error_status === 'number' ? env.api_error_status : null;
  if (env.is_error || env.subtype !== 'success') {
    const text = `${typeof env.result === 'string' ? env.result : ''}\n${stderr}`;
    return { ok: false, code: classifyCliFailure(text, apiStatus), detail: firstLine(text) || String(env.subtype), durationMs };
  }
  const output = env.structured_output ?? env.result;
  const outputText = typeof output === 'string' ? output : JSON.stringify(output ?? null);
  if (outputText.length > req.maxOutputChars) {
    return { ok: false, code: 'E-SCHEMA', detail: `${req.role} 출력 ${outputText.length}자가 상한 ${req.maxOutputChars}자를 넘음`, durationMs };
  }
  const models = env.modelUsage && typeof env.modelUsage === 'object' ? Object.keys(env.modelUsage) : [];
  return {
    ok: true, output, outputChars: outputText.length, durationMs,
    modelId: models[0] ?? 'unknown', // P1-6-R4: 설정값이 아니라 CLI가 보고한 값
    usage: {
      inputTokens: num(env.usage?.input_tokens),
      outputTokens: num(env.usage?.output_tokens),
      costUsd: num(env.total_cost_usd),
    },
  };
}

function firstLine(s: string): string {
  return s.split('\n').map((x) => x.trim()).find(Boolean)?.slice(0, 300) ?? '';
}

function num(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

