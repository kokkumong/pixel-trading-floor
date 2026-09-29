---
name: next-phase
description: PIXEL TRADING FLOOR의 다음 Phase 하나를 이 세션에서 끝까지 진행한다. 진행 상황 확인 → 이슈 → 브랜치 → TDD 구현 → 다음 세션 인계 갱신 → PR → 검사 통과 시 병합 → 보고 후 정지. 사용자가 /next-phase, "다음 phase 진행", "Phase N 진행"이라고 할 때 사용한다.
---

# 다음 Phase 진행 (한 세션 = 한 Phase)

사용자 선호: brainstorming·writing-plans는 건너뛴다 (계획은 CLAUDE.md에 있다). 하위 에이전트 없이 이 세션에서 직접 구현한다. TDD로 한다. 끝나면 사용량을 보고하고 **다음 Phase는 시작하지 않는다**.

인자로 Phase 번호를 받으면(`/next-phase 6`) 그 Phase를, 없으면 진행표의 다음 Phase를 한다.

## 0. 상황 확인 (코드를 건드리기 전에)

1. CLAUDE.md "진행 상황과 남은 단계" 표에서 대상 Phase를 정한다. 굵게 표시되고 "다음"인 행이 대상이다. 표 아래 "Phase N 참고" 절이 이전 세션의 인계다.
2. 저장소 상태를 확인한다.
   - `git status -sb`, `git fetch -q origin --prune`, `git log --oneline -5 origin/main`
   - `gh pr list -R kokkumong/pixel-trading-floor --state open`, `gh issue list -R kokkumong/pixel-trading-floor --state open`
3. 사용량을 확인한다: `mcp__ccd_session_mgmt__get_usage`. 5시간 한도가 70% 넘게 쓰였으면, 초기화까지 남은 시간과 함께 알리고 계속할지 묻는다. 이전 Phase는 5시간 한도의 60~80%를 썼다.
4. 사용자에게 짧게 보고한다: 완료된 Phase, 이번 대상 Phase와 범위 한 줄, 한도 상태. 그리고 바로 진행한다.
5. 멈추고 물어볼 경우:
   - 커밋 안 된 변경이 있다
   - `main`이 아닌 브랜치에 있다
   - 열린 PR이 있다 (검사가 통과했으면 병합부터 하자고 제안한다)
   - 대상 Phase의 이슈가 이미 열려 있다 (그 이슈를 이어서 할지 묻는다)

## 1. 범위 파악

- 진행표의 해당 행과 "Phase N 참고" 절을 읽는다.
- `ls docs/`로 최신 명세 파일을 찾는다. 파일명을 외우지 않는다. 필요한 절만 읽는다: `grep -n '^#' <명세>`로 목차를 보고, `P0-<n>-T<m>`·`P1-<n>-T<m>` 검증 ID로 찾는다.
- 이번 Phase의 **통과 기준(검증 ID 목록)**을 정한다. 이 목록이 이슈의 완료 기준과 테스트 이름이 된다.
- 명세 안의 `[코드 확인 필요]`는 "구현 시 결정할 것"으로 읽고, 정한 내용은 인계 절에 남긴다.

## 2. 이슈와 브랜치 (CONVENTION.md)

- 이슈: `gh issue create -R kokkumong/pixel-trading-floor --title "[FEAT] Phase N: <내용>" --body-file -`
  - 본문은 `.github/ISSUE_TEMPLATE/feat.md`의 세 절을 따른다: `## 무엇을 하나요`, `## 관련 명세`, `## 완료 기준`
  - 완료 기준에는 검증 ID를 체크 항목으로 넣는다
  - 빈 `- ` 항목을 남기면 이슈 검사 봇이 이슈를 닫는다
- 브랜치: `git checkout main && git pull -q && git checkout -b feature/<이슈번호>-phase<N>-<짧은-영문-이름>`

## 3. 구현

- 스택 규칙(CLAUDE.md)을 지킨다:
  - 런타임 의존성 0개
  - 지울 수 있는 TS 문법만
  - 상대 import에 `.ts`, 타입만 가져올 때는 `import type`
  - 웹 UI는 `// @ts-check` 순수 JS
- TDD: 테스트를 먼저 쓰고, 실패를 확인한 뒤 구현한다. 테스트 이름은 검증 ID로 시작한다. 예: `test('P1-6-T1 ...')`
- 테스트는 fixture·scripted 백엔드로만 한다. 기존 도구를 쓴다:
  - `test/data-helpers.ts`: `replayAcquirer`, `replaySnapshot`
  - `test/job-helpers.ts`: `autoDriver`, `tempEngine`
- 핵심 규칙은 결함 주입으로 확인한다. 한 줄을 망가뜨려 해당 테스트가 실패하는지 보고 되돌린다.
- 실제 claude·외부 API는 Phase 마지막 수동 스모크 1회에서만 쓴다. 필요할 때만 `node scripts/run-job.ts <종목> <모드>`를 실행하고, 호출 수·시간·비용을 기록한다.
- 작업 단위마다 규칙에 맞는 커밋을 한다. 형식: `<feat|fix|design|refactor|docs|chore|test>: <한글 포함 요약>`, 끝에 `Co-Authored-By` 줄.

## 4. 다음 세션 인계 갱신 (PR에 포함)

CLAUDE.md를 갱신한다. **다음 세션은 이것만 보고 시작한다.**
- 진행표: 이번 Phase 행을 `✅`로 바꾸고 굵게 표시를 뺀다. 다음 Phase 행을 굵게 하고 상태를 `다음`으로 둔다.
- "Phase N 참고" 절을 "Phase N+1 참고"로 바꾼다. 내용:
  - 다음 Phase가 쓸 API와 파일
  - 이번에 내린 결정
  - 남은 일, 미뤄진 항목
  - 실측값
- 이번 Phase에서 생긴 모듈 설명은 해당 계층 절(데이터 계층, 작업 엔진 등)에 짧게 추가한다.
- 명세를 고쳐야 하면 문서 개정 규칙을 따른다: 파일 하나를 새 버전명으로 rename하고 개정 이력에 한 줄 추가.

## 5. 검증 → PR → 병합

1. `npm run verify`가 통과해야 한다 (tsc + 전체 테스트). 실패를 숨기지 않는다.
2. `git push -u origin <브랜치>`
3. PR: `gh pr create -R kokkumong/pixel-trading-floor --base main --title "<커밋 규칙 형식의 제목>" --body-file -`
   - `.github/pull_request_template.md`의 절을 그대로 둔다: 변경 내용, `Close #<이슈번호>`, 검증, 체크리스트 4개 `[x]`
   - 본문 끝에 `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
4. `mcp__ccd_pr__get_status`로 검사를 확인한다. PR이 이 세션에 연결되지 않았으면 `mcp__ccd_pr__bind_pr`로 연결한다.
   - **모두 통과**: `gh pr merge <번호> -R kokkumong/pixel-trading-floor --merge --delete-branch`로 바로 병합한다 (사용자 승인된 규칙). 그 뒤 `git checkout main && git pull -q && git branch -d <브랜치>`.
   - **실패**: 로그를 보고(`gh run view <id> --log-failed`) 고친 뒤 다시 push한다. 병합하지 않는다.
   - **아직 진행 중**: CI를 반복 조회하지 않는다 (금지). 사용자에게 "잠시 뒤 아무 메시지나 보내 주세요"라고 하고, 다음 메시지에서 한 번 확인한다.

## 6. 보고하고 정지

- 통과 기준별 결과: 검증 ID → 통과한 테스트
- 스모크 결과 (했다면)
- PR·이슈 링크와 병합 여부
- 사용량: `mcp__ccd_session_mgmt__get_usage`의 5시간·주간 한도와 이 세션 컨텍스트
- 다음 Phase 이름. 그리고 "새 세션에서 `/next-phase`로 시작하세요"

다음 Phase는 시작하지 않는다.
