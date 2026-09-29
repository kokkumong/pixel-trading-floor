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

## 스택 규칙
- Node >= 22.18, TypeScript를 **네이티브 타입 제거**로 직접 실행 (`node src/cli/floor.ts`). 빌드·`dist/` 없음
- 지울 수 있는 문법만: `enum`·`namespace`·매개변수 프로퍼티 금지 → 유니온 리터럴과 `as const` 객체
- 상대 import는 `.ts` 확장자까지 쓴다. 타입만 가져올 때는 `import type`
- **런타임 의존성 0개**. `node:` 내장 모듈만. devDependencies는 `typescript`, `@types/node`뿐
- 웹 UI(`src/web/`)는 빌드 없는 순수 JS + `// @ts-check`
- 검증: `npm run verify` (= `tsc --noEmit` + `node --test`). 커밋 전 항상 통과시킨다
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
- 서버 기본 바인딩 `127.0.0.1`. LAN은 `--lan` + 토큰 + 읽기 전용 — 명세 7장
- 뉴스·RSS 등 외부 텍스트는 불신 데이터 블록으로 분리 (프롬프트 인젝션 방지)

## 아키텍처 핵심
- 단계 엔진 `next / submit / finalize` 하나를 브라우저(SubprocessDriver), `/floor`(세션), 데모(FixtureDriver)가 공유한다 (P1-5-R1)
- 작업 기록: `jobs/<jobId>/job.json`. 원자적 갱신, 종료 상태는 바뀌지 않음, 서버 시작 시 진행 중 작업은 `INTERRUPTED` (P1-1)
- 리포트: `reports/*.json`이 원본이고 `.md`는 JSON에서 생성한다. `COMPLETED`만 리포트가 된다 (P1-6)
- 과거 판정 회고는 기본으로 꺼져 있다 (P1-9)
- 오류는 `E-*` 코드와 사용자 안내로 표시한다 (P1-1.5)

## claude -p 호출 규약 (스파이크 결과, Claude Code 2.1.280 / macOS)
```
claude -p --safe-mode --tools "" --no-session-persistence --output-format json \
  --model <m> --system-prompt-file <역할 프롬프트 파일> --json-schema <고정 스키마 JSON>
  (입력 데이터는 stdin, cwd는 작업마다 새로 만든 빈 임시 디렉터리)
```
- `--safe-mode`: CLAUDE.md·스킬·플러그인·훅·MCP를 끈다. 구독(OAuth) 인증은 그대로 동작한다. `--bare`는 API 키 인증만 되므로 쓰지 않는다
- `--system-prompt`로 기본 프롬프트를 교체하면 입력 오버헤드가 거의 없다 (haiku 실측 입력 1,383토큰, 7초)
- 실제 모델 ID는 `modelUsage`의 키로 보고된다 (P1-6-R4)
- 응답 JSON: `type:"result"`, `subtype:"success"`, `is_error`, `result`(문자열), **`structured_output`(스키마 강제 객체)**, `usage.input_tokens/output_tokens`, `total_cost_usd`, `duration_ms`, `api_error_status`
- 실행 파일은 셸 alias가 아니라 실제 경로로 찾는다 (`claude`가 alias일 수 있음). spawn은 셸 없이 인자 배열로
- env는 허용 목록으로 구성하고 `ANTHROPIC_API_KEY`는 기본 제외한다. `FLOOR_USE_API_KEY=1`일 때만 넘긴다 (P1-7-R6)
- 취소: macOS/Linux는 `spawn({detached:true})` + `process.kill(-pid)`로 약 1초 안에 그룹 전체가 종료됨 (확인함). Windows는 `taskkill /pid <pid> /T /F` (Windows에서 미검증)
- **인증 실패(설정 없음 + 잘못된 키)일 때 오류를 내지 않고 무기한 대기했다.** 호출 시간 제한은 필수이고, 분석 전에 `diag`로 로그인 상태를 확인한다

## 데이터 계층 (src/core/data)
- 흐름: `registry.resolve*` → `collectSources`(네트워크) → `assembleSnapshot`(순수 함수: 무결성·신선도·품질·지표·해시) → `buildRoleInput`/`fitInput`
- 공급자: Binance(현물·무기한·펀딩), Bybit/Bitget/Gate(비교·추정), Yahoo(주식·환율·미국 종목 조회), CoinGecko, alternative.me, Google 뉴스 RSS. 도메인 목록은 `net.ts`의 `ALLOWED_HOSTS`
- 녹화 fixture: `node scripts/record-fixtures.ts` → `fixtures/test/http/*.json`. 테스트는 `test/data-helpers.ts`의 `replaySnapshot`으로 재생 (네트워크 없음)
- 지표 기대값: `python3 fixtures/indicators/gen_expected.py` (독립 구현, P1-3-R12)
- 달력 `calendars.json`: KRX는 2026년까지만 (2027 휴장일은 KRX 12월 공고 뒤 추가), NYSE는 2027년까지
- 실데이터 검증으로 명세에 반영된 규칙 (P0 v0.6~, P1 v0.2): 주식 장중 TTL 25분, 외환 주말 규칙, 스캘핑 뉴스 수집(VIBE 제목만), NYSE Arca 허용, 달력 만료 30일 전 진단 경고

## 모델 호출 계층 (src/core/model, src/core/job/budget.ts·retry.ts)
- `createClaudeCliDriver` → `callRole`(예산 검사·재시도·호출 기록) → 역할 검증 함수. 드라이버: claude-cli(실전), fixture(데모, 호출 수 0), scripted(테스트)
- 테스트용 가짜 CLI: `test/fixtures/fake-claude.mjs` (표준 입력의 `#MODE=ok|env|auth|quota|garbage|long|hang`, 진단용 `--version`·`auth status`와 `--fake-auth=claude.ai|none|apiKey|garbage`)
- `runClaudeCommand(exe, args)`: `--version`·`auth status --json` 같은 짧은 하위 명령 (셸 없음, 허용 목록 env, 시간 제한)
- 역할별 모델·사고 수준: `config/floor.config.json`의 `models` → `modelFor(role)`
- 실측(haiku, TARO 1회, Phase 3): 기본 68.7초·출력 7,638토큰, `--effort low` 54.4초·5,143토큰 → Phase 4에서 스키마 길이 축소 (narrative 1000자, claims 최대 6개)
- 실측(sonnet, BTC scalp 5회, Phase 4 스모크): 43초, 출력 합계 6,401토큰, 보고 비용 $0.18, 재시도 0, 근거 참조 오류 0
- 실측(sonnet, BTC algorithm 13회, Phase 5 스모크 = M1): 86초, 출력 합계 약 14,300토큰, 보고 비용 $0.458, 재시도 0, 토론 2라운드, PM 기각

## 작업 엔진 (src/core/job, src/core/prompts)
- `state.ts` 상태 머신(P1-1), `record.ts` job.json 형식, `store.ts` 원자적 저장(디스크가 종료 상태면 저장 거부), `steps.ts` 다음 단계 계산·토론 조기 종료·역할 출력 검증(순수), `decide.ts` RuleContext·FinalDecision 조립, `engine.ts` 단계 엔진, `runner.ts` 드라이버 루프
- `createEngine({store, now})` → `createJob(req, acquirer)`(해석·수집·스냅샷. INSUFFICIENT_DATA는 여기서 종료) → `next(job)`(대기 단계 목록 + `inputs/<stepId>.json` 기록. 애널리스트는 여러 개) → `submit(job, stepId, raw)` → `finalize(job, {save})`
  - 다음 단계는 커서가 아니라 출력에서 계산한다 (`pendingSteps`). stepId는 역할 이름, 토론은 `BULL-1`, `BEAR-2`
  - `/floor`(single_session)는 CLI 명령마다 `openJob(jobId)`(스냅샷 해시 검증)로 이어간다. submit 실패는 재시도로 세고 두 번째 실패면 SCHEMA_ERROR. finalize에서 P0-F-R5 예산 검사
  - `runJob(engine, job, driver, signal)`: 병렬 단계 중 하나가 실패하면 나머지를 취소하고 첫 실패 코드로 끝낸다
  - PM MODIFY의 `modifiedFields`는 코드가 계산한다(비면 스키마 오류). REJECT → `proposal: null` + `PM_REJECTED`, ACE 제안은 `outputs.proposal`에 보존
  - COMPLETED·INSUFFICIENT_DATA만 `finalDecision`을 가진다. 시작 시 `recoverInterrupted(kill, hasReport)`: 진행 중 작업 → INTERRUPTED, 기록된 PID는 명령줄에 claude가 있을 때만 그룹째 종료. SAVING에서 멈췄는데 리포트 JSON이 있으면 COMPLETED로 확정
  - `sweepAbandoned(exceptJobId)`: 스냅샷 뒤 `maxDurationSeconds`가 지난 진행 중 single_session 작업 → INTERRUPTED (P1-5-T3). CLI가 명령마다 부른다
  - `Acquirer.clockSkewMs()`: 수집 중 Date 헤더로 잰 시계 오차. 60초 초과면 스냅샷 전에 FAILED(E-CLOCK), 30초 초과면 경고 (`data/clock.ts`)
- 프롬프트 = `shared/common` + (`shared/briefing` | `shared/proposal` + `no-trade` 또는 `forced`) + `roles/<역할>`. 해시는 조합된 전문의 sha256 앞 12자 (`prompts.hash(role, mode)`), 작업 기록 `promptHashes`에 남는다
- 강제 방향 ACE·BLITZ의 CLI 스키마는 action에서 NO_TRADE를 뺀다 (`jsonSchemaFor`). 검증 코드 V-ACTION은 그대로
- 테스트 도구: `test/job-helpers.ts`의 `autoDriver(overrides)`(입력을 읽어 정상 출력 생성), `test/data-helpers.ts`의 `replayAcquirer(fixture)`
- 실전 1건 실행: `node src/cli/floor.ts analyze <종목> <모드>` (실제 데이터·claude, 기록은 `jobs/`, 리포트는 `reports/`)

## 리포트·데모·진단·CLI (src/core/report, demo.ts, diag.ts, src/cli)
- 리포트: `buildReport(job, meta, completedAt)`(순수, P1-6.2 메타데이터 + 스냅샷 전체 포함) → `renderMarkdown(report)`(JSON만 입력) → `ReportStore.save`. 엔진에는 `reportSaver(store, {claudeCliVersion}, now)`를 `finalize`/`runJob`의 `save`로 넘긴다. 저장 경로는 job.json `report`
  - 파일명: 로컬 시간대, `:`→`-` (`2026-09-29T17-25-59+09-00_CRYPTO-BTC_algorithm_b7bca590[_SIM|_LITE][_DEMO]`). 강제 방향 데모는 `_SIM_DEMO`
  - 같은 프로세스에서 MD 단계가 실패하면 JSON도 지우고 E-DISK. 프로세스가 죽으면 JSON만 남을 수 있고 `repair()`가 MD를 다시 만든다. `cleanupTmp(now)`는 1시간 지난 `.tmp-*` 삭제
  - `list(tab)`: `analysis`(기본, 데모 제외) · `simulation` · `lightweight` · `demo`. `get(jobId)`: 파일명의 jobId 앞 8자로 찾고 내용으로 확인
- 데모: `fixtures/demo/v1/manifest.json`(모드 → 시나리오), `<이름>.snapshot.json`(수집 직후 SourceRecord + 시각), `<이름>.responses.json`(역할별 원래 모델 출력, 스냅샷 ID는 `{{snapshotId}}`). `demoAcquirer`(BlockedNet 연결) + `demoDriver` + `demoClock`(녹화 시각 + 실제 경과). 재조립한 스냅샷 해시가 원본과 같다
  - 새 데모: 실전 작업 뒤 `node scripts/make-demo.ts <jobId> <이름>` → manifest에 추가. 지금은 algorithm(PM 기각), scalp(ACE 관망)만 있고 forced_direction 데모는 없다
- 진단: `runDiagnostics({net, dirs, env, executable, claudeTest})` → Node·Claude CLI(존재, 버전 ≥ 2.1.280, `auth status`의 loggedIn·authMethod)·API 키 환경변수·공급자 9곳·시계 오차·달력·쓰기 권한·선택 시험 호출(haiku 1회). 이메일·키 값은 결과에 넣지 않는다
- CLI `node src/cli/floor.ts <analyze|snapshot|next|submit|finalize|doctor>`: `main(argv, deps)`로 테스트한다(의존성 주입). 루트는 `FLOOR_HOME` 또는 프로젝트 폴더. 종료 코드 `EXIT`(P1-5.1: 0, 1 기타, 2 종목, 3 데이터, 4 스키마, 5 예산, 10 단계 없음)
  - `next`는 `inputs/<단계>.json`, `prompts/<단계>.md`, `schemas/<단계>.json`, 출력 자리 `outputs/<단계>.json`을 준다. `submit --file`은 작업 디렉터리 안 파일만
  - `analyze`는 interface `web`·subprocess_per_role로 기록한다. 실전 전 `auth status`로 로그인 확인(미로그인 시 작업을 만들지 않음). `--demo`는 fixture 재생

## HTTP 서버 (src/server, src/web)
- `npm start` = `node src/server/main.ts [--lan] [--port N] [--enable-project-zip] [--lan-allow-analyze]`. 기본 `127.0.0.1:8000`(`PORT` 환경변수), LAN은 `--lan` 또는 `FLOOR_LAN=1` → `0.0.0.0`
  - `startServer(argv, env, out)`: `manager.recover()`(web 작업만 INTERRUPTED, 리포트 repair, 임시 파일 정리) → `app.listen()` → 안내 출력. LAN 토큰 주소는 서버 창에만 한 번. 서버 창 `r`+Enter 재발급, Ctrl+C는 실행 중 분석 취소 뒤 종료
- `security.ts`(순수): `LanAuth`(128비트 토큰, 2시간, 재발급 시 세션 전부 무효, 세션 만료 = 토큰 만료), `allowedHosts`/`checkHost`/`checkOrigin`, `decideAccess`(접근 등급 read·analyze·local), `RateLimiter`, `redact`(sk-ant-, 토큰·쿠키, `?t=`, 홈 경로 사용자 이름)
- `app.ts` `createApp(opts)`: 요청 검사 순서 Host → 요청 수(모두 120/분) → `/?t=` 첫 접속(쿠키 발급 + 302) → 경로 표(없으면 404) → 접근 등급 → Origin(GET 외) → 분석 실행 수(3/분). 경로 표 = P0 명세 v0.7 7.4절. 모든 응답에 CSP·nosniff·no-referrer·no-store
  - 테스트는 `clientIp` 옵션으로 LAN 기기를 흉내 낸다 (`x-test-ip` 헤더, 운영 코드는 소켓 주소만)
- `jobs.ts` `JobManager`: `start({symbol, mode, idempotencyKey, demo})` → started | busy(409) | rejected(400·503). 입력은 `normalizeSymbolInput`·모드 열거형 그대로(별칭 없음)·키 `[A-Za-z0-9_-]{8,64}`. 같은 키는 진행 중 약속 → 작업 기록 순서로 찾는다. 슬롯은 Claude 확인 전에 동기적으로 예약. `cancel`·`cancelAll`·`idle`·`view`·`snapshot`·`subscribe`
  - 이벤트: 작업 기록이 저장될 때마다 `{type:'job', job: JobView}`, 역할 호출 `{type:'call', phase:'start'|'end', role, ...}`, 끝 `{type:'end', state}`. SSE는 구독 → 현재 보기 → (끝났으면 바로 end)
  - `view.ts` `jobView`: PID·절대 경로 없음, 오류 상세는 홈 경로 가림, E-CLI-MISSING·E-AUTH·E-CLOCK이면 `hint: '/diagnostics'`, `panel`(panelView), `reportUrl`
- `pages.ts`: 서버가 그리는 HTML(리포트 목록·열람, 진단, project.zip 확인). `html` 태그 템플릿이 모든 값을 이스케이프. 리포트 본문은 Markdown을 `<pre>`에 이스케이프해서 보인다 (Markdown 렌더러는 Phase 7)
- `zip.ts` 의존성 없는 ZIP(deflate, UTF-8 이름, ZIP64 없음). `bundle.ts` project.zip 목록(제외: `.env*`, `.claude`, `*credentials*`, `node_modules`, `reports`, `jobs`, `logs`, `*.key`, `*.pem`, `.git`, 심볼릭 링크)과 목록 해시
- `src/web/`: **Phase 6 임시 화면**(index.html·app.js·app.css). 분석 실행 → SSE 로그 → 리포트 링크, `?demo=1` 워터마크. 인라인 스크립트·스타일 없음(CSP). Phase 7에서 픽셀 UI로 바꾼다
- 테스트 도구: `test/server/server-helpers.ts`의 `manager()`(녹화 데이터 + autoDriver), `test/server/zip-reader.ts`의 `readZip`

## 진행 상황과 남은 단계
범위: P0와 P1 전체 (보완안 14.2 릴리스 게이트). 각 단계는 명세 검증 ID를 통과 기준으로 하고, 끝나면 `npm run verify` 통과 후 커밋한다.

**한 세션 = 한 Phase.** 새 세션은 `/next-phase`(`.claude/skills/next-phase/SKILL.md`)로 시작한다. 이 명령은 아래 순서로 진행한다: 이 표와 "Phase N 참고" 절 확인 → 이슈·브랜치 → TDD 구현 → 이 표와 인계 절 갱신 → PR·병합 → 사용량 보고 후 정지. Phase가 끝날 때마다 표와 "Phase N+1 참고" 절을 반드시 갱신한다.

| Phase | 내용 | 상태 |
|---|---|---|
| 0 | 골격, claude -p 스파이크 | ✅ |
| 1 | 스키마 DSL, 규칙 엔진, 표시 규칙 (`src/core/schema`, `src/core/rules`) | ✅ |
| 2 | 레지스트리, 달력, 지표, 공급자 어댑터, 스냅샷, 역할별 입력 (`src/core/data`) | ✅ |
| 3 | claude 드라이버, 오류 코드, 예산, 재시도 (`src/core/model`, `src/core/job/budget.ts`, `retry.ts`) | ✅ |
| 4 | 작업 엔진과 역할 프롬프트 (`src/core/job`, `src/core/prompts`) | ✅ |
| 5 | 리포트(JSON 원본 + MD), CLI 6개 명령(analyze·snapshot·next·submit·finalize·doctor), 데모 fixture → M1 | ✅ |
| 6 | HTTP 서버와 보안 경계 (P0-7, P1-7, SSE, zip, /diagnostics) | ✅ |
| **7** | **픽셀 UI (가이드 PDF 화면 구성)** | 다음 |
| 8 | `/floor` 명령, 시작 스크립트, 가이드 v1.3, P1-11 실측 | |

### Phase 7 참고 (다음 세션)
- 화면이 쓸 API (전부 `src/server/app.ts` 경로 표):
  - `GET /api/status` → `{mode, lan:{warning, expiresAt}|null, client:{local, canAnalyze, readOnly}, running:[jobId], demoModes, projectZip}`. 읽기 전용이면 ANALYZE 버튼을 숨긴다, LAN이면 상단에 `LAN 공유 중 · 암호화되지 않음`
  - `POST /api/analyze` `{symbol, mode, idempotencyKey, demo}` → 202 `{jobId, job}` / 200 같은 키 기존 작업 / 409 `{error:'E-BUSY', running: JobView}` / 400·503 `{error, message, hint?}`. 키는 클릭 의도마다 한 번 만들고 응답 전 재전송에 재사용 (`src/web/app.js` 참고). 헤더 `Content-Type: application/json` 필수, Origin은 브라우저가 붙인다
  - `GET /api/jobs/<id>/events` SSE: `job`(JobView 전체, 저장마다) · `call`(역할 시작·끝, 말풍선 연출용) · `end`. 구독 전 이벤트는 오지 않으므로 첫 `job`의 `outputs`로 화면을 복원한다
  - `GET /api/jobs/<id>/snapshot`: 전광판·콘솔의 데이터 수집 로그·뉴스 제목용 (외부 텍스트: textContent로만)
  - `POST /api/jobs/<id>/cancel`, `GET /api/reports?tab=`, 리포트 열람 `/reports/<id>`
- 반드시 지킬 것: 모델 출력·뉴스는 원시 HTML 금지(P1-7-R11) → Markdown 렌더러를 쓰면 원시 HTML을 막고 링크는 http/https + `rel="noopener noreferrer"`, 외부 이미지 금지. P1-7-T2의 화면 쪽 검증은 Phase 7에서 한다. CSP 때문에 인라인 스크립트·스타일·외부 폰트 불가 (파일로 `src/web/`에 두고 `STATIC_NAME` 규칙 `[a-z0-9-]+.(html|js|css|svg|png|ico)`을 따른다. 하위 폴더 없음)
  - 데모 화면 전체와 결과 패널 안에 `DEMO · 실제 데이터 아님` (P1-8-R4), 강제 방향은 `강제 방향 시뮬레이션 · 판정 아님` 배지(P0-5-R3), 확신도는 LOW/MEDIUM/HIGH만(`%` 금지), PM 없는 결과에 `PM 승인` 금지 → `panelView` 결과를 그대로 쓴다
- 아직 없는 API: **전광판 시세**(가이드 4-1·4-4, 15초 갱신, 한국 종목 멀티 거래소). 데모에서는 fixture 시세(P1-8-R5), LAN 등급은 read. 경로를 추가하면 P0 명세 7.4 표도 갱신한다
- 이번 결정: 서버 복구는 subprocess_per_role 작업만(`recoverInterrupted`의 `only`), 세션 쿠키 만료 = 토큰 만료, 분석 실행 요청 제한은 인증·출처 통과 요청만 셈, 데모도 LAN에서는 분석 실행으로 보고 차단, 서버 내부 오류로 멈춘 작업은 `E-INTERRUPTED`(새 오류 코드를 만들지 않음), 리포트 JSON 다운로드는 원본 파일 그대로
- 알려진 한계: 서버 시작 순간 별도 프로세스의 `floor.ts analyze`(web·subprocess 작업)가 돌고 있으면 그 작업도 INTERRUPTED가 된다. macOS 기본 `unzip`(Info-ZIP 6.0)은 UTF-8 파일명을 `?`로 보인다(데이터는 정상, Windows 탐색기는 정상)
- 실측(sonnet, 서버 경로 BTC scalp 1회, Phase 6 스모크): 32.9초, 호출 5회, 재시도 0, 출력 5,512토큰, 보고 비용 $0.132, 결과 ACE 관망. 데모 algorithm(연출 지연 1.2초/역할)은 약 16초
- 남은 일: 브리핑·토론 근거 참조의 존재 검사 경고 (P1-10-R1, 지금은 제안서만), P1-10-R3 수치 불일치 경고, 강제 방향 데모 fixture, CoinGecko 403 원인(알고리즘 스모크에서 PARTIAL_DATA, 진단 ping은 통과), P0-F-T4(/floor 도구 제한, Phase 8), 시작 스크립트 `start-floor.cmd`·`start-floor-lan.cmd`와 가이드 9장 개정(P0-7.6, Phase 8)
- 확인용: `npm start` → http://localhost:8000/?demo=1, `node --test "test/server/*.test.ts"`
