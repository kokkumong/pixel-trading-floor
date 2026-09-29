# PIXEL TRADING FLOOR — 협업 라이프사이클 및 컨벤션 가이드

커밋·브랜치·이슈·PR 규칙을 모았습니다. 혼자(사람 1 + Claude) 개발하는 저장소지만, **"이 코드가 왜, 무엇을 위해 바뀌었는지"**를 나중에 추적할 수 있게 같은 규칙을 씁니다. Claude가 작업할 때도 이 규칙을 따릅니다.

> 스택: Node ≥ 22.18 · TypeScript 네이티브 타입 제거 · 런타임 의존성 0개 · 빌드 없는 웹 UI
> 분석 시뮬레이션이며 실제 주문·자금 이동 기능은 없고 넣지 않습니다.

---

## 1. 커밋(Commit) 컨벤션

`Conventional Commits` 방식을 씁니다.

첫 줄 형식: `<타입>: <작업 내용 요약(한글 포함)>`
예) `feat: 리포트 JSON 원본과 Markdown 생성 추가`

| 타입 | 언제 사용 | 예시 |
|---|---|---|
| **feat** | 새 기능, Phase 작업 | `feat: 작업 엔진과 역할 프롬프트 추가` |
| **fix** | 버그 수정 | `fix: 토론 조기 종료 판단 오류 해결` |
| **design** | 픽셀 UI 디자인 변경 | `design: 판정 패널 강제 방향 색 적용` |
| **refactor** | 기능 변경 없이 구조 개선 | `refactor: 단계 계산을 steps.ts로 분리` |
| **docs** | 명세·가이드·주석 수정 | `docs: P1 명세 v0.3 리포트 파일명 규칙` |
| **chore** | 설정·CI·스크립트 등 잡일 | `chore: CI에 커밋 메시지 검사 추가` |
| **test** | 테스트 코드 | `test: P1-6-T1 같은 초 리포트 충돌 테스트` |

- 첫 줄 뒤에 빈 줄을 두고 본문에 세부 내용을 적습니다. 본문은 영어·한국어 모두 됩니다.
- 커밋 전에 `npm run verify`를 통과시킵니다 (CLAUDE.md 스택 규칙).
- Claude가 만든 커밋은 끝에 `Co-Authored-By:` 줄을 붙입니다.

> 🚨 **시스템 강제**: `commit-msg` 훅이 검사합니다. 아래 경우 `git commit`이 **거부**됩니다.
> - 타입이 표에 없거나 `<타입>: ` 형식이 아닐 때
> - **첫 줄 요약에 한글이 하나도 없을 때**
>
> git이 만드는 `Merge …`, `Revert "…"` 메시지는 통과합니다.
> Husky·Commitlint 대신 의존성 없는 `.githooks/commit-msg` + `scripts/conventions.ts`를 씁니다 (런타임 의존성 0개 규칙). `npm install` 때 `core.hooksPath`가 자동으로 설정됩니다. PR에서는 CI가 같은 검사를 다시 합니다.

---

## 2. 브랜치(Branch) 전략

혼자 개발하므로 `dev` 없이 두 종류만 씁니다.

1. **`main`**: 항상 `npm run verify`가 통과하는 상태. **직접 커밋하지 않습니다.**
2. **`feature/<이슈번호>-<작업명>`**: 작업 브랜치. 예) `feature/3-report-writer`, `feature/7-floor-command`
   - 버그도 같은 형식을 씁니다. 예) `feature/9-debate-stop-fix`

### 👉 작업 순서
1. **Issue 생성** → 이슈 번호(예: #3) 발급
2. `git checkout main` → `git pull origin main`
3. `git checkout -b feature/3-report-writer`
4. 코딩 → 규칙에 맞게 커밋 → `git push -u origin feature/3-report-writer`
5. GitHub에서 `feature/3-…` → `main`으로 **Pull Request** (템플릿 준수)
6. 검사가 모두 통과하면 **사람이 직접 병합**합니다 (Squash가 아니라 Merge commit 또는 Rebase — 커밋 메시지 규칙이 그대로 남도록)
7. 병합 뒤 로컬 정리: `git checkout main && git pull && git branch -d feature/3-report-writer`

> ⚠️ 무료 플랜의 Private 저장소는 GitHub 브랜치 보호 규칙을 쓸 수 없어 `main` 직접 푸시를 서버가 막지 못합니다. 규칙으로 지킵니다.

---

## 3. Issue(이슈) — "작업 시작 전 반드시 이슈부터"

이슈는 **"이 작업을 한다"**를 남기는 작업 지시서입니다.

- **진행 상황 추적**: Phase마다, 또는 Phase 안의 큰 덩어리마다 이슈 하나
- **코드 연결**: PR에 `Close #3` → 병합 시 이슈가 자동으로 닫힘
- 템플릿 2종: 기능 추가 `[FEAT]`, 버그 리포트 `[BUG]` (빈 이슈는 만들 수 없음)
- **제목은 반드시 `[FEAT] ` 또는 `[BUG] `로 시작**하고, 본문의 빈 `- `, `- [ ] `, `1. ` 항목을 남기지 않습니다.
- `[FEAT]` 이슈의 "관련 명세"에는 검증 ID(`P1-6-R5`)나 명세 절 번호를 적습니다.

> 🚨 **시스템 강제**: 제목 접두어가 없거나, 본문이 비었거나, 빈 항목이 있으면 이슈 검사 봇(GitHub Action)이 사유를 댓글로 남기고 이슈를 **닫습니다**. 고친 뒤 다시 열면(Reopen) 다시 검사합니다.

---

## 4. Pull Request(PR) 템플릿과 통합 검증(CI)

- PR을 만들면 템플릿이 자동으로 채워집니다. **양식을 지우지 마세요.**
- `## 변경 내용`에 무엇을 왜 바꿨는지 적고, `Close #이슈번호`를 반드시 기입합니다.
- **체크리스트 4개를 모두 `[x]`로 체크**합니다. 해당 없는 항목(예: 새 테스트가 없음)은 확인했다는 뜻으로 체크합니다.
- `## 검증`에는 실행한 명령과 결과를 적습니다. 실제 claude를 호출했다면 호출 수·소요 시간·비용을 함께 적습니다.

### 🤖 봇이 실행하는 검사

| 검사 | 하는 일 | 실패하면? |
|---|---|---|
| **CI · 타입 검사 + 테스트** | `npm ci` → `npm run verify` (`tsc --noEmit` + `node --test`, fixture·scripted만 사용) | ❌ 고쳐서 다시 push |
| **CI · 커밋 메시지 검사** | PR에 들어간 모든 커밋이 1장 규칙을 따르는지 | ❌ `git rebase -i`로 메시지 수정 후 force push |
| **PR 템플릿 검사** | 변경 내용 20자 이상, `Close #번호`, 체크리스트 4개 체크 | ❌ PR 설명을 Edit (자동으로 다시 검사) |
| **리뷰** | 필요하면 Claude Code의 `/code-review`로 검토 | 지적사항 반영 권장 |

모든 검사가 통과해야 병합합니다. 혼자 하는 저장소라 팀원 Approve는 요구하지 않습니다 (GitHub에서 본인 PR은 승인할 수 없음).

> CI는 실제 claude나 외부 API를 호출하지 않습니다. 실제 호출은 수동 스모크 테스트(`node scripts/run-job.ts`)에서만 합니다.

---

## 5. 시크릿(Secret)과 산출물 — 절대 커밋 금지

- **`ANTHROPIC_API_KEY`** 등 API 키: 코드·설정 파일·커밋에 넣지 않습니다. 기본은 구독(OAuth) 로그인이며, 키는 `FLOOR_USE_API_KEY=1`일 때만 하위 프로세스에 넘깁니다 (P1-7-R6). `.env`, `.env.*`는 `.gitignore` 처리되어 있습니다.
- **Claude 인증 파일**(`~/.claude/`)은 저장소 밖에 있고, 모델 호출은 빈 임시 디렉터리에서 도구 없이 실행합니다 (E11).
- **`jobs/`(작업 기록·역할 입출력), `reports/`(분석 리포트)**: 실행 결과물이라 `.gitignore` 처리되어 있습니다. 공유가 필요하면 파일을 따로 전달합니다.
- **테스트 fixture**(`fixtures/test/http/`)는 공개 시세·뉴스 응답만 담습니다. 녹화 전에 개인 정보나 토큰이 섞이지 않았는지 확인합니다.
- 실제 주문·자금 이동 코드, 거래소 API 키 입력 기능은 넣지 않습니다.

---

## 6. 최초 세팅

```bash
# 1. 저장소 클론
git clone https://github.com/kokkumong/pixel-trading-floor.git
cd pixel-trading-floor

# 2. 개발 도구 설치 + 커밋 훅 설정 (Node 22.18 이상)
npm install

# 3. 검증
npm run verify

# 4. 실제 분석을 돌리려면 Claude Code 설치·로그인 (claude 실행 후 /login)
```
