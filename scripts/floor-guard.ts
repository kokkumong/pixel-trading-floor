// /floor 도구 제한 훅 (P1-5-R3, P0-F-R1·R4, P0-F-T4). .claude/skills/floor/SKILL.md의 PreToolUse 훅으로 모든 도구 호출 전에 실행된다.
// 허용: 공통 코어 명령(snapshot·next·submit·finalize) 실행, jobs/<jobId>/ 안 파일 읽기·쓰기. 나머지(웹 조회·검색, 다른 파일, 다른 명령)는 거부.
// Claude Code 훅 규약: 표준 입력에 {tool_name, tool_input, cwd, ...} JSON. 종료 코드 2 + stderr = 차단하고 이유를 모델에게 전달, 0 = 통과.
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ToolUse {
  tool_name?: unknown;
  tool_input?: unknown;
  cwd?: unknown;
}
export interface Verdict {
  allow: boolean;
  reason: string;
}

const CORE_COMMANDS = ['snapshot', 'next', 'submit', 'finalize'] as const;
/** 명령별 허용 옵션. 값은 모두 하나씩 받는다 */
const OPTIONS: Record<(typeof CORE_COMMANDS)[number], readonly string[]> = {
  snapshot: ['--symbol', '--mode', '--interface'],
  next: ['--job'],
  submit: ['--job', '--role', '--file'],
  finalize: ['--job'],
};
const FILE_TOOLS = ['Read', 'Write', 'Edit'];
const HINT = '/floor에서는 `node src/cli/floor.ts <snapshot|next|submit|finalize> ...`와 jobs/<jobId>/ 안 파일의 Read·Write만 쓸 수 있습니다';

const deny = (reason: string): Verdict => ({ allow: false, reason: `${reason}. ${HINT}` });
const ok: Verdict = { allow: true, reason: '' };

/**
 * 셸 해석 없이 단어로 나눈다. 따옴표 밖의 셸 메타문자(; & | < > $ ` 괄호, 줄바꿈 등)가 하나라도 있으면 null.
 * 작은따옴표 안은 글자 그대로(Windows 경로의 \ 포함), 큰따옴표 안에서는 $ ` \ ! 를 허용하지 않는다.
 */
function splitWords(command: string): string[] | null {
  const words: string[] = [];
  let cur = '';
  let inWord = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (ch === ' ' || ch === '\t') {
      if (inWord) words.push(cur);
      cur = '';
      inWord = false;
    } else if (ch === "'" || ch === '"') {
      const end = command.indexOf(ch, i + 1);
      if (end < 0) return null;
      const inner = command.slice(i + 1, end);
      if (/[\r\n]/.test(inner) || (ch === '"' && /[$`\\!]/.test(inner))) return null;
      cur += inner;
      inWord = true;
      i = end;
    } else if (/[\p{L}\p{N}_.\/:=@+,%-]/u.test(ch)) {
      cur += ch;
      inWord = true;
    } else {
      return null;
    }
  }
  if (inWord) words.push(cur);
  return words;
}

/** `node src/cli/floor.ts <코어 명령> [옵션 값]...`이면 명령과 인자, 아니면 거부 이유 */
export function parseCoreCommand(command: string, root: string): { command: string; args: string[] } | string {
  const words = splitWords(command);
  if (!words) return '셸 메타문자·치환·연결·리다이렉트는 쓸 수 없습니다 (값은 작은따옴표로 감쌉니다)';
  const [node, script, cmd, ...rest] = words;
  if (node !== 'node' || !script || resolve(root, script) !== resolve(root, 'src', 'cli', 'floor.ts')) return '공통 코어 CLI만 실행할 수 있습니다';
  if (!CORE_COMMANDS.includes(cmd as (typeof CORE_COMMANDS)[number])) return `허용하지 않는 코어 명령: ${String(cmd).slice(0, 20)}`;
  const allowed = OPTIONS[cmd as (typeof CORE_COMMANDS)[number]];
  const args: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i]!;
    const eq = w.indexOf('=');
    const [flag, value] = w.startsWith('--') && eq > 0 ? [w.slice(0, eq), w.slice(eq + 1)] : [w, rest[++i]];
    if (!allowed.includes(flag)) return `허용하지 않는 옵션: ${flag.slice(0, 20)}`;
    if (value === undefined || value.startsWith('--')) return `${flag}에 값이 필요합니다`;
    if (flag === '--interface' && value !== 'floor') return '--interface는 floor만 쓸 수 있습니다';
    args.push(flag, value);
  }
  return { command: cmd!, args };
}

/** 읽기는 next가 알려주는 파일 자리(입력·프롬프트·스키마·출력)만, 쓰기는 출력만. 스냅샷 원본과 job.json은 역할별 입력이 아니다 (P0-F-R3) */
const READ_DIRS = ['inputs', 'prompts', 'schemas', 'outputs'];
const WRITE_DIRS = ['outputs'];

/** jobs/<jobId>/<하위 폴더>/<파일>이면 하위 폴더 이름 */
function jobSubdir(path: string, cwd: string, root: string): string | null {
  const rel = relative(resolve(root, 'jobs'), resolve(cwd, path));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  const parts = rel.split(sep);
  return parts.length >= 3 ? parts[1]! : null;
}

export function judgeToolUse(input: ToolUse, root: string): Verdict {
  const tool = typeof input.tool_name === 'string' ? input.tool_name : '';
  const args = (input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {}) as Record<string, unknown>;
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : root;
  if (tool === 'Bash') {
    const r = typeof args.command === 'string' ? parseCoreCommand(args.command.trim(), root) : '명령이 없습니다';
    return typeof r === 'string' ? deny(r) : ok;
  }
  if (FILE_TOOLS.includes(tool)) {
    const p = args.file_path;
    if (typeof p !== 'string' || !p) return deny(`${tool}: 파일 경로가 없습니다`);
    const dirs = tool === 'Read' ? READ_DIRS : WRITE_DIRS;
    const sub = jobSubdir(p, cwd, root);
    return sub !== null && dirs.includes(sub) ? ok : deny(`${tool}: jobs/<jobId>/{${dirs.join(',')}}/ 밖의 파일은 ${tool === 'Read' ? '읽을' : '쓸'} 수 없습니다`);
  }
  return deny(`${tool || '(이름 없음)'} 도구는 /floor에서 쓸 수 없습니다 (웹 조회·검색·다른 파일 접근 금지)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let verdict: Verdict;
  try {
    const input = JSON.parse(readFileSync(0, 'utf8')) as ToolUse;
    const root = process.env.FLOOR_HOME ?? process.env.CLAUDE_PROJECT_DIR ?? (typeof input.cwd === 'string' ? input.cwd : process.cwd());
    verdict = judgeToolUse(input, resolve(root));
  } catch {
    verdict = deny('훅 입력을 읽지 못했습니다');
  }
  if (!verdict.allow) {
    process.stderr.write(verdict.reason + '\n');
    process.exit(2);
  }
}
