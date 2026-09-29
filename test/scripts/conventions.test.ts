import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkCommitMessage, checkIssue, checkPr } from '../../scripts/conventions.ts';

const template = (p: string) => readFileSync(new URL(`../../.github/${p}`, import.meta.url), 'utf8');

test('커밋: 허용 타입 + 콜론 + 한글이 들어간 요약만 통과한다', () => {
  for (const ok of ['feat: 리포트 저장 추가', 'fix: 토론 조기 종료 오류 해결', 'docs: P1 명세 v0.3', 'test: P1-6-T1 리포트 이름 충돌', 'chore: CI에 Node 22 지정', 'refactor: 엔진 단계 계산 분리', 'design: 판정 패널 색']) {
    assert.deepEqual(checkCommitMessage(ok), [], ok);
  }
  assert.ok(checkCommitMessage('feature: 기능 추가').length > 0); // 없는 타입
  assert.ok(checkCommitMessage('feat 리포트 저장').length > 0); // 콜론 없음
  assert.ok(checkCommitMessage('feat:리포트').length > 0); // 콜론 뒤 공백 없음
  assert.ok(checkCommitMessage('Phase 4: 작업 엔진').length > 0); // 타입 아님
  assert.match(checkCommitMessage('feat: add report writer').join(), /한글/); // 순수 영어
});

test('커밋: 본문·트레일러·git 주석은 보지 않고, git이 만든 병합·되돌리기 메시지는 통과한다', () => {
  assert.deepEqual(checkCommitMessage('# 주석\nfeat: 리포트 저장 추가\n\nbody in english\n\nCo-Authored-By: Claude <x@y>'), []);
  assert.ok(checkCommitMessage('feat: add writer\n\n본문에만 한글').length > 0); // 한글은 첫 줄에
  assert.deepEqual(checkCommitMessage("Merge branch 'main' into feature/3-report"), []);
  assert.deepEqual(checkCommitMessage('Revert "feat: 리포트 저장 추가"'), []);
  assert.ok(checkCommitMessage('').length > 0);
});

test('이슈: 제목은 [FEAT] 또는 [BUG]로 시작하고, 본문에 빈 항목이 없어야 한다', () => {
  const body = '## 무엇을 하나요\n- 리포트 저장\n\n## 완료 기준\n- [ ] P1-6-T1';
  assert.deepEqual(checkIssue('[FEAT] 리포트 저장', body), []);
  assert.deepEqual(checkIssue('[BUG] 토론이 끝나지 않음', '## 증상\n- 3라운드 진행\n\n## 재현 방법\n1. BTC 알고리즘 실행'), []);
  assert.ok(checkIssue('리포트 저장', body).length > 0);
  assert.ok(checkIssue('[feat] 리포트 저장', body).length > 0);
  assert.ok(checkIssue('[FEAT]', body).length > 0); // 접두어만
  assert.match(checkIssue('[FEAT] 리포트', '## 무엇을 하나요\n- \n').join(), /빈 항목/);
  assert.match(checkIssue('[FEAT] 리포트', '## 완료 기준\n- [ ] \n').join(), /빈 항목/);
  assert.match(checkIssue('[BUG] 오류', '## 재현 방법\n1. \n').join(), /빈 항목/);
  assert.ok(checkIssue('[FEAT] 리포트', '<!-- 설명만 -->\n').length > 0); // 주석만 있는 본문
});

test('이슈 템플릿을 그대로 제출하면 차단된다 (빈 항목을 채워야 통과)', () => {
  for (const name of ['feat.md', 'bug.md']) {
    const body = template(`ISSUE_TEMPLATE/${name}`).replace(/^---[\s\S]*?---\n/, '');
    assert.ok(checkIssue(name === 'feat.md' ? '[FEAT] 제목' : '[BUG] 제목', body).length > 0, name);
  }
});

test('PR: 체크리스트 4개 모두 체크, Close #번호, 변경 내용이 있어야 한다', () => {
  const tpl = template('pull_request_template.md');
  assert.ok(checkPr(tpl).length > 0); // 템플릿 그대로는 차단
  const filled = tpl
    .replace('<!-- 무엇을 왜 바꿨는지 -->', '<!-- 무엇을 왜 바꿨는지 -->\n리포트 JSON 원본과 MD 생성을 추가했다. 파일명은 P1-6 규칙.')
    .replace('Close #', 'Close #3')
    .replaceAll('- [ ]', '- [x]');
  assert.deepEqual(checkPr(filled), []);
  assert.match(checkPr(filled.replace('Close #3', 'Close #')).join(), /Close #/);
  assert.match(checkPr(filled.replace('- [x]', '- [ ]')).join(), /체크리스트/);
  assert.match(checkPr(filled.replace(/## 체크리스트[\s\S]*/, '')).join(), /체크리스트/); // 양식을 지움
  assert.match(checkPr(filled.replace('리포트 JSON 원본과 MD 생성을 추가했다. 파일명은 P1-6 규칙.', '')).join(), /변경 내용/);
  assert.deepEqual(checkPr(filled.replace('Close #3', 'Closes #3')), []);
});
