# PIXEL TRADING FLOOR

AI 에이전트 13명(역할)이 시장 데이터를 분석·토론·심사해 판정을 내리는 **분석 시뮬레이션**. 실제 주문·자금 이동 기능은 없고 넣지 않는다.

## 문서 (진실의 원천)
- `docs/PIXEL-TRADING-FLOOR-P0-명세-v*.md` — 계약과 검증 항목 (`P0-<n>-R<m>`, `P0-<n>-T<m>`)
- `docs/PIXEL-TRADING-FLOOR-P1-명세-v*.md` — 첫 실전 분석 전 기능 (상태 머신, 레지스트리, 지표 정의, 위험 거리, /floor 코어, 리포트, 보안, 데모·진단, 근거 인용)
- `docs/PIXEL-TRADING-FLOOR-구조-보완안-v*.md` — 목표 구조, 우선순위(5장), P2
- 문서 버전은 수시로 올라간다. 파일명을 외우지 말고 `ls docs/`로 최신 파일을 찾는다
- 구현 범위: P0와 P1 전체. `/floor`는 처음부터 공통 코어 구조로 만든다 (과도기 `lightweight`는 스키마에만 존재)
- `docs/PIXEL-TRADING-FLOOR-가이드-v1.2.pdf` — 사용자용 화면·기능 설명 (구현 대상 UI의 모습)
- 명세 안의 `[코드 확인 필요]`는 신규 프로젝트이므로 "구현 시 결정할 것"으로 읽는다
- 문서 개정: 파일 하나를 새 버전명으로 rename하고 개정 이력에 한 줄 추가. 이전 버전 사본을 남기지 않는다
- `docs/HANDOFF.md` — 진행표, 다음 세션 인계, 실측 기록. `docs/ARCHITECTURE.md` — 계층별 상세(모듈·함수·결정). 둘 다 버전 이름 없이 제자리에서 고친다

## 스택 규칙
- Node >= 22.18, TypeScript를 **네이티브 타입 제거**로 직접 실행 (`node src/cli/floor.ts`). 빌드·`dist/` 없음
- 지울 수 있는 문법만: `enum`·`namespace`·매개변수 프로퍼티 금지 → 유니온 리터럴과 `as const` 객체
- 상대 import는 `.ts` 확장자까지 쓴다. 타입만 가져올 때는 `import type`
- **런타임 의존성 0개**. `node:` 내장 모듈만. devDependencies는 `typescript`, `@types/node`뿐
- 웹 UI(`src/web/`)는 빌드 없는 순수 JS + `// @ts-check`
- 검증: `npm run verify` (= `tsc --noEmit` 두 번(서버 `tsconfig.json`, 웹 JS `tsconfig.web.json` checkJs) + `node --test`). 커밋 전 항상 통과시킨다. Claude는 출력이 짧은 `npm run -s verify:quiet`(같은 검사, dot 리포터)를 쓴다
- 테스트 이름은 명세 검증 ID로 시작한다: `test('P0-3-T1 롱 손절가 역전 → NO_TRADE', ...)`
- 테스트는 fixture·scripted 백엔드로만. 실제 claude·외부 API 호출은 수동 스모크 테스트에서만

## 협업 규칙 (CONVENTION.md)
- 저장소: https://github.com/kokkumong/pixel-trading-floor (Private). `main`에 직접 커밋하지 않는다
- 흐름: `[FEAT]`·`[BUG]` 이슈 생성(템플릿의 빈 항목 없이) → `feature/<이슈번호>-<작업명>` 브랜치 → 커밋 → PR(`main` 대상, 템플릿 유지, `Close #번호`, 체크리스트 4개 `[x]`) → **CI·PR 템플릿 검사가 모두 통과하면 Claude가 바로 병합한다** (1인 개발, 사용자 승인 2026-09-29). 병합 방식은 merge commit(`gh pr merge --merge --delete-branch`), 실패한 검사가 있으면 병합하지 않고 고친다
- 커밋 첫 줄: `<feat|fix|design|refactor|docs|chore|test>: <한글 포함 요약>`. `commit-msg` 훅과 CI가 검사한다 (`scripts/conventions.ts`)
- Phase 작업은 Phase마다 이슈 하나를 기본으로 한다

## 핵심 계약 요약 (자세한 내용은 명세 절 참조)
- 모드: `algorithm` | `scalp` | `forced_direction` (화면명: 알고리즘 / 스캘핑 20x / 강제 방향 시뮬레이션)
- 계획 호출 수: algorithm `4 + 2×rounds + 1 + 3 + 1` = 11~13 (최대 17), scalp·forced 5 (최대 7) — 명세 1.5, 8.3
- 최종 의사결정자: algorithm=PM, scalp·forced=ACE. PM이 없는 결과에 `PM 승인` 문구 금지 — 명세 2장
- `action`: ENTER_LONG | ENTER_SHORT | NO_TRADE, `bias`: BULLISH | BEARISH | NEUTRAL (분리 저장) — 명세 3.2
- 모델 출력 `TradeProposal` ≠ 시스템 확정 `FinalDecision`. 규칙(`V-*`)은 **코드**로 적용 — 명세 3.3~3.6
- 확신도: 화면엔 LOW/MEDIUM/HIGH만, `%` 금지, 규칙에 사용 금지 — 명세 3.5
- 스냅샷: 작업당 한 번 수집, 불변, `snapshotHash`. 에이전트는 외부 조회 불가, 역할별 투영 입력만 — 명세 4장
- 추정 시세(`estimated`)는 판정 기준 불가. 필수 소스 실패 시 모델 호출 없이 `INSUFFICIENT_DATA`
- 외부 요청은 전부 `src/core/data/net.ts`(도메인 허용 목록)를 거친다. 데모 모드는 코드로 차단
- 서버 기본 바인딩 `127.0.0.1`. 이 PC 접속도 로컬 토큰 주소(`/?t=`)로 열어 쿠키를 받는다. LAN은 `--lan` + LAN 토큰 + 읽기 전용 — 명세 7장
- 뉴스·RSS 등 외부 텍스트는 불신 데이터 블록으로 분리 (프롬프트 인젝션 방지)

## 아키텍처 핵심
- 단계 엔진 `next / submit / finalize` 하나를 브라우저(SubprocessDriver), `/floor`(세션), 데모(FixtureDriver)가 공유한다 (P1-5-R1)
- 작업 기록: `jobs/<jobId>/job.json`. 원자적 갱신, 종료 상태는 바뀌지 않음, 서버 시작 시 진행 중 작업은 `INTERRUPTED` (P1-1)
- 리포트: `reports/*.json`이 원본이고 `.md`는 JSON에서 생성한다. `COMPLETED`만 리포트가 된다 (P1-6)
- 과거 판정 회고는 기본으로 꺼져 있다 (P1-9)
- 오류는 `E-*` 코드와 사용자 안내로 표시한다 (P1-1.5)

## 계층 지도
상세는 `docs/ARCHITECTURE.md`의 해당 절만 읽는다 (`grep -n '^## ' docs/ARCHITECTURE.md`).

| 계층 | 위치 | ARCHITECTURE.md 절 |
|---|---|---|
| 스키마 DSL·규칙 엔진 | `src/core/schema`, `src/core/rules` | (코드 참조) |
| 데이터: 레지스트리·수집·스냅샷·역할 입력 | `src/core/data` | 데이터 계층 |
| claude 호출 규약·드라이버·예산·재시도 | `src/core/model`, `src/core/job/budget.ts`·`retry.ts` | claude -p 호출 규약, 모델 호출 계층 |
| 작업 엔진·프롬프트 | `src/core/job`, `src/core/prompts` | 작업 엔진 |
| 리포트·데모·진단·CLI | `src/core/report`, `demo.ts`, `diag.ts`, `src/cli` | 리포트·데모·진단·CLI |
| HTTP 서버·보안·픽셀 UI | `src/server`, `src/web` | HTTP 서버 |

- claude 실행은 **호출 시간 제한 필수** (인증 실패 시 오류 없이 무기한 대기함). 규약은 ARCHITECTURE.md 첫 절
- 테스트 도구: `test/data-helpers.ts`(`replayAcquirer`, `replaySnapshot`), `test/job-helpers.ts`(`autoDriver`), `test/server/server-helpers.ts`(`manager()`), 가짜 CLI `test/fixtures/fake-claude.mjs`

## 토큰 절약 (작업 방식)
모델 호출마다 지금까지의 대화 전체를 다시 읽는다. 지난 Phase 세션은 호출당 평균 문맥 20만~32만 토큰, 재읽기가 출력의 200배였다. 문맥에 넣는 양을 줄인다.
- **좁게 읽기**: 파일을 통째로 `cat`하지 않고, 여러 파일을 이어 붙여 읽지 않는다. `grep -n`으로 위치를 찾고 `sed -n 'a,bp'`로 필요한 범위만(한 번에 150줄 이하). 명세·ARCHITECTURE.md는 `grep -n '^#'` 목차 → 필요한 절만
- 한 번 읽은 파일은 다시 읽지 않는다. 편집 뒤 확인용 재읽기를 하지 않는다
- **긴 출력 줄이기**: 검증은 `npm run -s verify:quiet`. 출력이 길 수 있는 명령은 `| tail -n 40` 또는 파일로 받아 `grep`. CI 실패는 `gh run view <id> --log-failed | tail -n 80`
- **브라우저**: `read_page`(`filter: interactive`)·`find`·`get_page_text`·`javascript_tool`로 텍스트 확인이 기본. 스크린샷은 모양 확인에 꼭 필요할 때만 `scale: 0.5`로, 증빙은 마지막 1장. 이미지는 세션 끝까지 문맥에 남는다
- **PDF**: 가이드 PDF를 Read로 열지 않는다. `pdftotext -f <쪽> -l <쪽> -layout <파일> -`로 필요한 쪽만
- **세션 나누기**: 세션 문맥이 20만 토큰을 넘으면(`get_usage`) 작업 단위를 끝내고 `docs/HANDOFF.md` "진행 중" 절에 인계를 쓰고 멈춘다. 새 세션의 `/next-phase`가 이어받는다
- **모델**: 설계·구현은 Opus, 인계 문서·PR·병합·단순 수정은 Sonnet

## 진행 상황
진행표·다음 Phase 인계·실측은 `docs/HANDOFF.md`. 새 세션은 `/next-phase`(`.claude/skills/next-phase/SKILL.md`)로 시작한다.
