// 협업 규칙 검사 (CONVENTION.md). 런타임 의존성 없이 git 훅과 GitHub Actions가 같은 함수를 쓴다.
//   node scripts/conventions.ts install-hooks          git이 .githooks/를 쓰도록 설정 (npm install 때 자동)
//   node scripts/conventions.ts commit-msg <파일>      commit-msg 훅
//   node scripts/conventions.ts commits <base> <head>  PR의 커밋 메시지 전체 (CI)
//   node scripts/conventions.ts issue | pr             GITHUB_EVENT_PATH의 이슈·PR 본문 (CI). 실패 사유는 CHECK_REPORT 파일에도 쓴다
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const COMMIT_TYPES = ['feat', 'fix', 'design', 'refactor', 'docs', 'chore', 'test'] as const;

const HANGUL = /[\p{Script=Hangul}]/u;
const SUBJECT = new RegExp(`^(${COMMIT_TYPES.join('|')}): \\S`);

const stripComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '');

export function checkCommitMessage(message: string): string[] {
  const lines = message.split('\n').filter((l) => !l.startsWith('#'));
  const subject = (lines.find((l) => l.trim() !== '') ?? '').trim();
  if (/^Merge /.test(subject) || /^Revert "/.test(subject)) return []; // git이 만든 메시지
  const errors: string[] = [];
  if (!subject) return ['커밋 메시지가 비어 있습니다'];
  if (!SUBJECT.test(subject)) errors.push(`첫 줄은 "<타입>: <요약>" 형식이어야 합니다. 타입: ${COMMIT_TYPES.join(', ')} (받은 값: "${subject.slice(0, 60)}")`);
  if (!HANGUL.test(subject)) errors.push('첫 줄 요약에 한글이 하나 이상 있어야 합니다');
  return errors;
}

/** 빈 목록 항목: "- ", "- [ ] ", "1. " */
function emptyItems(body: string): number {
  return stripComments(body).split('\n').filter((l) => /^\s*(-(\s+\[[ xX]\])?|\d+\.)\s*$/.test(l)).length;
}

export function checkIssue(title: string, body: string | null): string[] {
  const errors: string[] = [];
  if (!/^\[(FEAT|BUG)\] \S/.test(title)) errors.push('제목은 "[FEAT] " 또는 "[BUG] "로 시작하고 뒤에 내용이 있어야 합니다');
  const text = stripComments(body ?? '').replace(/^#+ .*$/gm, '').trim();
  if (!text) errors.push('본문이 비어 있습니다. 템플릿의 항목을 채워 주세요');
  const n = emptyItems(body ?? '');
  if (n > 0) errors.push(`본문에 빈 항목이 ${n}개 있습니다. 내용을 채우거나 줄을 지워 주세요`);
  return errors;
}

/** "## 제목" 아래 내용 (주석 제외) */
function section(body: string, heading: string): string | null {
  const m = new RegExp(`^## ${heading}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(body);
  return m ? stripComments(m[1]!).trim() : null;
}

export const PR_CHECKLIST_SIZE = 4;

export function checkPr(body: string | null): string[] {
  const b = body ?? '';
  const errors: string[] = [];
  const summary = section(b, '변경 내용');
  if (summary === null || summary.length < 20) errors.push('"## 변경 내용"에 무엇을 왜 바꿨는지 20자 이상 적어 주세요');
  if (!/\b(close[sd]?|fix(e[sd])?|resolve[sd]?) #\d+/i.test(stripComments(b))) errors.push('"Close #이슈번호"를 적어 주세요');
  const list = section(b, '체크리스트') ?? '';
  const checked = (list.match(/^- \[[xX]\] /gm) ?? []).length;
  const unchecked = (list.match(/^- \[ \] /gm) ?? []).length;
  if (checked < PR_CHECKLIST_SIZE || unchecked > 0) errors.push(`체크리스트 ${PR_CHECKLIST_SIZE}개를 모두 [x]로 체크해 주세요 (체크 ${checked}개, 미체크 ${unchecked}개). 양식을 지우지 마세요`);
  return errors;
}

function report(title: string, errors: string[]): never {
  if (errors.length === 0) {
    console.log(`${title}: 통과`);
    process.exit(0);
  }
  const text = [`**${title}: 규칙 위반**`, '', ...errors.map((e) => `- ${e}`), '', '규칙: CONVENTION.md'].join('\n');
  console.error(text);
  if (process.env.CHECK_REPORT) writeFileSync(process.env.CHECK_REPORT, text);
  process.exit(1);
}

function event(): Record<string, any> {
  const p = process.env.GITHUB_EVENT_PATH;
  if (!p || !existsSync(p)) throw new Error('GITHUB_EVENT_PATH 없음');
  return JSON.parse(readFileSync(p, 'utf8'));
}

if (import.meta.main) {
  const [cmd, a, b] = process.argv.slice(2);
  switch (cmd) {
    case 'install-hooks':
      try {
        execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
      } catch {
        console.warn('git 저장소가 아니어서 커밋 훅을 설치하지 않았습니다');
      }
      break;
    case 'commit-msg':
      report('커밋 메시지', checkCommitMessage(readFileSync(a!, 'utf8')));
      break;
    case 'commits': {
      const log = execFileSync('git', ['log', '--format=%H%x1f%B%x1e', `${a}..${b}`], { encoding: 'utf8' });
      const errors = log.split('\x1e').map((x) => x.trim()).filter(Boolean).flatMap((entry) => {
        const [sha, msg] = entry.split('\x1f') as [string, string];
        return checkCommitMessage(msg).map((e) => `${sha.slice(0, 7)} ${e}`);
      });
      report('커밋 메시지', errors);
      break;
    }
    case 'issue': {
      const e = event();
      report('이슈', checkIssue(e.issue.title, e.issue.body));
      break;
    }
    case 'pr': {
      const e = event();
      report('PR', checkPr(e.pull_request.body));
      break;
    }
    default:
      console.error('사용법: node scripts/conventions.ts install-hooks | commit-msg <파일> | commits <base> <head> | issue | pr');
      process.exit(2);
  }
}
