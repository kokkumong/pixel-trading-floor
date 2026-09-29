---
name: next-phase
description: PIXEL TRADING FLOOR의 다음 Phase를 진행한다. 세션을 나눠 진행한다 — 구현 세션(이슈 → 브랜치 → TDD 구현)과 마무리 세션(인계 갱신 → PR → 검사 통과 시 병합 → 보고). docs/HANDOFF.md "진행 중" 절이 차 있으면 거기서 이어간다. 사용자가 /next-phase, "다음 phase 진행", "Phase N 진행"이라고 할 때 사용한다.
---

# 다음 Phase 진행 (Phase 하나 = 세션 여러 개)

사용자 선호: brainstorming·writing-plans는 건너뛴다(계획은 `docs/HANDOFF.md`에 있다). 하위 에이전트 없이 이 세션에서 직접 구현한다. TDD로 한다. Phase가 끝나면 사용량을 보고하고 **다음 Phase는 시작하지 않는다**.

인자로 Phase 번호를 받으면(`/next-phase 6`) 그 Phase를, 없으면 진행표의 다음 Phase를 한다.

## 세션 나누기 (토큰 절약)

모델 호출마다 대화 전체를 다시 읽는다. 한 세션에서 Phase를 끝까지 하면 문맥이 30만~50만 토큰까지 커지고, 그 크기를 150~190번 다시 읽는다. 그래서 나눈다.

| 세션 | 단계 | 권장 모델 | 끝나는 조건 |
|---|---|---|---|
| 구현 | 0 → 1 → 2 → 3 | Opus | 통과 기준 전부 구현, `verify:quiet` 통과, push 완료 |
| (구현 계속) | 3 | Opus | 앞 세션이 문맥 한도로 중간 인계한 경우 |
| 마무리 | 4 → 5 → 6 | Sonnet | 병합과 보고 |

- **문맥 확인**: 커밋할 때마다 `mcp__ccd_session_mgmt__get_usage`로 이 세션 문맥을 본다. **20만 토큰을 넘으면** 지금 작업 단위를 끝내고(테스트 통과 상태로 커밋) "중간 인계"를 쓰고 멈춘다.
- **구현이 끝나면**: 문맥이 12만 토큰 미만이면 같은 세션에서 마무리까지 해도 된다. 그 이상이면 "중간 인계"(다음 단계: 마무리)를 쓰고 멈춘다. 사용자에게 "새 세션에서 모델을 Sonnet으로 바꾸고 `/next-phase`를 입력하세요"라고 안내한다.
- 읽기·출력 규칙은 CLAUDE.md "토큰 절약"을 따른다. 특히 파일 통째 `cat` 금지, `npm run -s verify:quiet`, 브라우저는 텍스트 우선.

### 중간 인계

`docs/HANDOFF.md` "진행 중 (세션 인계)" 절의 `없음`을 아래 형식으로 바꾸고, 브랜치에 커밋(`docs: Phase N 중간 인계`)하고 push한 뒤 멈춘다. **다음 세션은 이 절과 CLAUDE.md만 보고 이어간다.** 대화에서만 알던 사실은 전부 여기에 적는다.

```
- Phase: N, 이슈 #<번호>, 브랜치 `feature/<...>`
- 다음 단계: 구현 계속 | 마무리
- 통과 기준: <검증 ID> ✅ <테스트 파일> / <검증 ID> ⬜ (남음)
- 바꾼 파일: <경로 목록>
- 결정: <이번에 정한 것과 이유>
- 남은 일: <다음 세션이 할 일, 순서대로>
- 실측: <스모크 결과가 있으면 호출 수·시간·비용>
```

## 0. 상황 확인 (코드를 건드리기 전에)

1. `docs/HANDOFF.md`의 "진행표"와 "진행 중" 절을 읽는다. 필요하면 "Phase N 참고" 절도 읽는다. `grep -n '^## ' docs/HANDOFF.md`로 위치를 찾아 필요한 절만 읽는다.
   - **"진행 중" 절이 차 있으면 이어가기**: 그 브랜치로 전환하고(`git checkout <브랜치> && git pull -q`) 1·2단계를 건너뛴 뒤 "다음 단계"로 간다. 마무리 단계인데 현재 모델이 Opus면 Sonnet으로 바꾸면 더 싸다고 한 줄 알리고 그대로 진행한다.
   - 비어 있으면 진행표에서 굵게 표시되고 "다음"인 행이 대상이다.
2. 저장소 상태를 확인한다.
   - `git status -sb`, `git fetch -q origin --prune`, `git log --oneline -5 origin/main`
   - `gh pr list -R kokkumong/pixel-trading-floor --state open`, `gh issue list -R kokkumong/pixel-trading-floor --state open`
3. 사용량을 확인한다: `mcp__ccd_session_mgmt__get_usage`. 5시간 한도가 70% 넘게 쓰였으면 초기화까지 남은 시간과 함께 알리고 계속할지 묻는다.
4. 사용자에게 짧게 보고한다: 대상 Phase와 범위 한 줄, 이번 세션이 할 단계(구현·구현 계속·마무리), 한도 상태. 그리고 바로 진행한다.
5. 멈추고 물어볼 경우:
   - 커밋 안 된 변경이 있다
   - "진행 중" 절이 비었는데 `main`이 아닌 브랜치에 있다
   - "진행 중" 절에 없는 열린 PR이 있다 (검사가 통과했으면 병합부터 하자고 제안한다)
   - "진행 중" 절이 비었는데 대상 Phase의 이슈가 이미 열려 있다 (그 이슈를 이어서 할지 묻는다)

## 1. 범위 파악

- 진행표의 해당 행과 "Phase N 참고" 절을 읽는다.
- `ls docs/`로 최신 명세 파일을 찾는다. 파일명을 외우지 않는다. 필요한 절만 읽는다: `grep -n '^#' <명세>`로 목차를 보고, `P0-<n>-T<m>`·`P1-<n>-T<m>` 검증 ID로 찾는다.
- 건드릴 계층은 CLAUDE.md "계층 지도"에서 찾고, `docs/ARCHITECTURE.md`는 그 절만 읽는다.
- 이번 Phase의 **통과 기준(검증 ID 목록)**을 정한다. 이 목록이 이슈의 완료 기준과 테스트 이름이 된다.
- 명세 안의 `[코드 확인 필요]`는 "구현 시 결정할 것"으로 읽고, 정한 내용은 인계에 남긴다.

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
- 기존 코드는 필요한 부분만 읽는다. 쓰려는 함수의 시그니처는 `grep -n 'export'`로 먼저 찾는다.
- TDD: 테스트를 먼저 쓰고, 실패를 확인한 뒤 구현한다. 테스트 이름은 검증 ID로 시작한다. 예: `test('P1-6-T1 ...')`. 한 파일만 돌릴 때는 `node --test --test-reporter=dot <파일>`.
- 테스트는 fixture·scripted 백엔드로만 한다. 기존 도구를 쓴다:
  - `test/data-helpers.ts`: `replayAcquirer`, `replaySnapshot`
  - `test/job-helpers.ts`: `autoDriver`, `tempEngine`
- 핵심 규칙은 결함 주입으로 확인한다. 한 줄을 망가뜨려 해당 테스트가 실패하는지 보고 되돌린다.
- 실제 claude·외부 API는 Phase 마지막 수동 스모크 1회에서만 쓴다. 필요할 때만 `node src/cli/floor.ts analyze <종목> <모드>`를 실행하고, 호출 수·시간·비용을 기록한다.
- 작업 단위마다 규칙에 맞는 커밋을 한다. 형식: `<feat|fix|design|refactor|docs|chore|test>: <한글 포함 요약>`, 끝에 `Co-Authored-By` 줄. 커밋 뒤 문맥을 확인한다(위 "세션 나누기").
- 구현이 끝나면 `npm run -s verify:quiet` 통과 → `git push -u origin <브랜치>` → 위 "구현이 끝나면" 규칙에 따라 마무리로 가거나 중간 인계 후 멈춘다.

## 4. 다음 세션 인계 갱신 (PR에 포함)

`docs/HANDOFF.md`를 갱신한다. **다음 Phase의 세션은 이것과 CLAUDE.md만 보고 시작한다.**
- 진행표: 이번 Phase 행을 `✅`로 바꾸고 굵게 표시를 뺀다. 다음 Phase 행을 굵게 하고 상태를 `다음`으로 둔다.
- "Phase N 참고" 절을 "Phase N+1 참고"로 바꾼다. "진행 중" 절에 있던 결정·남은 일을 옮기고, "진행 중" 절은 `없음`으로 되돌린다. 내용:
  - 다음 Phase가 쓸 API와 파일
  - 이번에 내린 결정
  - 남은 일, 미뤄진 항목
- 실측값은 "실측 기록" 절에 한 줄로 추가한다.
- 이번 Phase에서 생긴 모듈 설명은 `docs/ARCHITECTURE.md`의 해당 계층 절에 짧게 추가한다. 새 계층이면 CLAUDE.md "계층 지도"에 한 줄 추가한다.
- CLAUDE.md 본문은 규칙·계약이 바뀔 때만 고친다. 인계·실측·모듈 설명을 CLAUDE.md에 쓰지 않는다(모든 세션의 모든 호출에 실린다).
- 명세를 고쳐야 하면 문서 개정 규칙을 따른다: 파일 하나를 새 버전명으로 rename하고 개정 이력에 한 줄 추가.

## 5. 검증 → PR → 병합

1. `npm run -s verify:quiet`가 통과해야 한다 (tsc + 전체 테스트). 실패를 숨기지 않는다. PR 본문의 테스트 수는 `npm test 2>&1 | grep -E '^# (tests|pass|fail)'`로 얻는다.
2. `git push -u origin <브랜치>`
3. PR: `gh pr create -R kokkumong/pixel-trading-floor --base main --title "<커밋 규칙 형식의 제목>" --body-file -`
   - `.github/pull_request_template.md`의 절을 그대로 둔다: 변경 내용, `Close #<이슈번호>`, 검증, 체크리스트 4개 `[x]`
   - 본문 끝에 `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
4. `mcp__ccd_pr__get_status`로 검사를 확인한다. PR이 이 세션에 연결되지 않았으면 `mcp__ccd_pr__bind_pr`로 연결한다.
   - **모두 통과**: `gh pr merge <번호> -R kokkumong/pixel-trading-floor --merge --delete-branch`로 바로 병합한다 (사용자 승인된 규칙). 그 뒤 `git checkout main && git pull -q && git branch -d <브랜치>`.
   - **실패**: 로그를 보고(`gh run view <id> --log-failed | tail -n 80`) 고친 뒤 다시 push한다. 병합하지 않는다.
   - **아직 진행 중**: CI를 반복 조회하지 않는다 (금지). 사용자에게 "잠시 뒤 아무 메시지나 보내 주세요"라고 하고, 다음 메시지에서 한 번 확인한다.

## 6. 보고하고 정지

- 통과 기준별 결과: 검증 ID → 통과한 테스트
- 스모크 결과 (했다면)
- PR·이슈 링크와 병합 여부
- 사용량: `mcp__ccd_session_mgmt__get_usage`의 5시간·주간 한도와 이 세션 문맥
- 다음 Phase 이름. 그리고 "새 세션에서 `/next-phase`로 시작하세요 (구현 세션은 Opus)"

다음 Phase는 시작하지 않는다.
