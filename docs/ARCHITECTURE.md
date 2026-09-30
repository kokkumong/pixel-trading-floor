# 아키텍처 상세

CLAUDE.md "계층 지도"의 상세판. 통째로 읽지 말고 `grep -n '^## ' docs/ARCHITECTURE.md`로 절을 찾아 필요한 절만 읽는다.
버전 이름을 붙이지 않고 제자리에서 고친다. 모듈을 새로 만들거나 계약이 바뀌면 해당 절에 짧게 추가한다.

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
- 근거 인용 검사(P1-10, `src/core/rules/audit.ts`): `auditEvidence(outputs, snapshot, derived)`는 **경고만** 만들고 판정은 바꾸지 않는다(강등은 규칙 엔진 V-EVIDENCE-REF). 제출마다 전체를 다시 계산해 `job.json evidenceAudit`에 넣고 → `JobView.evidenceAudit`(화면 콘솔 꼬리표) → 리포트 JSON `evidenceAudit`(Markdown 주장 꼬리표와 "## 근거 검사" 절)로 흐른다. 종류: `UNRESOLVED_REF`·`VALUE_MISMATCH`·`NO_BRIEF_REF`·`UNSOURCED_NUMBER`. 오탐 줄이기: 참조별 검사(본문 숫자 중 하나가 참조 값 0.5% 안이면 통과), 불일치는 다른 참조와도 안 맞는 숫자 중 참조 값 ±1% 안의 것만, 어림수(`약 N`·`N대`)와 한 자리 정수는 제외, 유효한 `snap:`·`derived:` 참조가 있는 발언은 새 수치 검사를 건너뜀. `claudeCliVersion`은 `RunOptions`/`FinalizeOptions`로 받아 `??=`로 처음 값만 기록(P1-11-R3)
- 프롬프트 = `shared/common` + (`shared/briefing` | `shared/proposal` + `no-trade`·`forced`·`position` 중 하나) + (보유 작업의 검토 역할: `shared/position-review`) + `roles/<역할>`. 해시는 조합된 전문의 sha256 앞 12자 (`prompts.hash(role, mode, held)`), 작업 기록 `promptHashes`에 남는다
- ACE·BLITZ의 CLI 스키마는 action을 좁힌다 (`jsonSchemaFor(role, mode, held)`): 강제 방향 ENTER_LONG·ENTER_SHORT, 보유 HOLD·ADD·REDUCE·EXIT, 그 외 ENTER_*·NO_TRADE. 검증 코드 V-ACTION·V-POS-STATE는 그대로 (PM `revisedProposal`은 좁히지 않음)
- 테스트 도구: `test/job-helpers.ts`의 `autoDriver(overrides)`(입력을 읽어 정상 출력 생성), `test/data-helpers.ts`의 `replayAcquirer(fixture)`
- 실전 1건 실행: `node src/cli/floor.ts analyze <종목> <모드>` (실제 데이터·claude, 기록은 `jobs/`, 리포트는 `reports/`)

## 리포트·데모·진단·CLI (src/core/report, demo.ts, diag.ts, src/cli)
- 리포트: `buildReport(job, meta, completedAt)`(순수, P1-6.2 메타데이터 + 스냅샷 전체 포함) → `renderMarkdown(report)`(JSON만 입력) → `ReportStore.save`. 엔진에는 `reportSaver(store, {claudeCliVersion}, now)`를 `finalize`/`runJob`의 `save`로 넘긴다. 저장 경로는 job.json `report`
  - 파일명: 로컬 시간대, `:`→`-` (`2026-09-29T17-25-59+09-00_CRYPTO-BTC_algorithm_b7bca590[_SIM|_LITE][_DEMO]`). 강제 방향 데모는 `_SIM_DEMO`
  - 같은 프로세스에서 MD 단계가 실패하면 JSON도 지우고 E-DISK. 프로세스가 죽으면 JSON만 남을 수 있고 `repair()`가 MD를 다시 만든다. `cleanupTmp(now)`는 1시간 지난 `.tmp-*` 삭제
  - `list(tab)`: `analysis`(기본, 데모 제외) · `simulation` · `lightweight` · `demo`. `get(jobId)`: 파일명의 jobId 앞 8자로 찾고 내용으로 확인
- 데모: `fixtures/demo/v1/manifest.json`(모드 → 시나리오), `<이름>.snapshot.json`(수집 직후 SourceRecord + 시각), `<이름>.responses.json`(역할별 원래 모델 출력, 스냅샷 ID는 `{{snapshotId}}`). `demoAcquirer`(BlockedNet 연결) + `demoDriver` + `demoClock`(녹화 시각 + 실제 경과). 재조립한 스냅샷 해시가 원본과 같다
  - 새 데모: 실전 작업 뒤 `node scripts/make-demo.ts <jobId> <이름>` → manifest에 추가. 지금은 algorithm(PM 기각), scalp(ACE 관망), forced_direction(scalp 녹화를 바탕으로 ACE 응답만 롱·`unforcedAction: NO_TRADE`로 손으로 쓴 fixture)이 있다. 데모 fixture는 근거 검사 경고 0건이어야 한다 (P1-10-T2)
- 진단: `runDiagnostics({net, dirs, env, executable, claudeTest})` → Node(`nodeCheck`: 최소 버전, `NODE_SECURITY_BASELINE` 보안 릴리스·지원 종료 경고. 새 보안 릴리스가 나오면 표 갱신)·Claude CLI(존재, 버전 ≥ 2.1.280, `auth status`의 loggedIn·authMethod)·API 키 환경변수·공급자 9곳·시계 오차·달력·쓰기 권한·선택 시험 호출(haiku 1회). 이메일·키 값은 결과에 넣지 않는다
- CLI `node src/cli/floor.ts <analyze|snapshot|next|submit|finalize|doctor>`: `main(argv, deps)`로 테스트한다(의존성 주입). 루트는 `FLOOR_HOME` 또는 프로젝트 폴더. 종료 코드 `EXIT`(P1-5.1: 0, 1 기타, 2 종목, 3 데이터, 4 스키마, 5 예산, 10 단계 없음)
  - `next`는 `inputs/<단계>.json`, `prompts/<단계>.md`, `schemas/<단계>.json`, 출력 자리 `outputs/<단계>.json`을 준다. `submit --file`은 작업 디렉터리 안 파일만
  - `analyze`는 interface `web`·subprocess_per_role로 기록한다. 실전 전 `auth status`로 로그인 확인(미로그인 시 작업을 만들지 않음). `--demo`는 fixture 재생
- `/floor`(P1-5): 스킬 `.claude/skills/floor/SKILL.md`(`context: fork`, `agent: floor-session`, `disable-model-invocation`)가 하위 에이전트 `.claude/agents/floor-session.md`(`tools: Bash, Read, Write`)를 부른다. **스킬 frontmatter의 `hooks`는 포크된 문맥에 걸리지 않으므로** 도구 제한 훅은 에이전트 frontmatter의 PreToolUse에 둔다: `scripts/floor-guard.ts`(Bash는 `node src/cli/floor.ts snapshot|next|submit|finalize`와 명령별 옵션만, 따옴표 밖 셸 메타문자 거부, Read는 `jobs/<id>/{inputs,prompts,schemas,outputs}/`, Write·Edit는 `outputs/`만). 테스트 `test/scripts/floor-guard.test.ts`
- `scripts/measure-budget.ts`(P1-11 도구): `run <종목> <모드> --count N`이 `analyze`를 반복 실행하고 `report [--interface floor]`가 job.json에서 백분위·산출값·명세 부록 표를 만든다. 본 측정(조합별 10회 이상)은 아직 안 함 (HANDOFF)
- 시작 스크립트 `start-floor.cmd`·`start-floor-lan.cmd`(P0-7.6): `node src\server\main.ts [--lan] --open`, 서버 출력을 파일로 남기지 않는다(LAN 토큰). `*.cmd`는 `.gitattributes`로 CRLF 고정

## 포지션 (src/core/position, P2)
- `book.ts`: 포지션 북 스키마(`positions/1`, 최대 50개, 레버리지 20 이하, 메모 200자)와 `validateBook(raw, isKnown)`(기본값 채움·id 부여, 오류는 `{path, message}`), `equityFor(book, currency)`
- `store.ts`: `.floor/positions.json` 읽기(`BookRead`: ok·missing·invalid)·쓰기(`.floor/` 0700, 임시 0600 → `.bak` 복사 → rename)
- `context.ts`: `buildPositionContext(read, snapshot, now)` → `position-context/1`(매칭 포지션 메모 제외·계좌·판정 기준 가격·`derive()` 파생 값·다른 시장 보유·경고·한 줄 notes). 작업 시작 때 한 번 만들어 `record.positionContext`에 고정. forced_direction·데모는 null
- `service.ts` `PositionService`: `GET/PUT /api/positions`의 뒷단. PUT은 북 전체 교체, `symbol`을 `resolveWithLookup`으로 해석, 응답 `BookView {status, book, errors, names}`
- 포지션 인지 판정(P2-2·3·4, Phase 13): 보유 여부는 `heldPosition(record)`(`job/record.ts`, forced는 항상 null)
  - 스키마: 행동 = `ENTRY_ACTIONS` + `POSITION_ACTIONS`. `proposal/3`에 `positionRef`·`sizeFraction`, `checkProposal`의 V-POS-STATE(`ProposalContext.positionId`)가 행동·참조·REDUCE 비율을 본다(스키마 오류 → 재시도). `decision/3`에 `positionRef`·`positionPlan`(적용 손절·목표·비율)·`sizing`
  - 규칙(`rules/engine.ts`, `rules/2`, `RuleContext.positionContext`): 보유 중 강등은 HOLD(계획은 기존 값, 수량 없음). ADD는 보유 방향 ENTER로 바꿔 진입 규칙을 적용. V-STOP-WIDEN(무시+경고)·V-EXIT-CONSISTENCY(무시)·V-POS-STOP-DIR(`STOP_ALREADY_HIT`)·V-POS-LIQ-BUFFER(청산가 입력 시 단순 V-LIQ-BUFFER 대신)·V-POS-LIQ-NEAR(`LIQUIDATION_NEAR`, ADD만 차단)·V-RISK-BUDGET(ADD 여유 0 → `RISK_BUDGET_FULL`)·HOLD의 근거 2개와 V-HOLD-INVALIDATION
  - 수량(`rules/sizing.ts` `suggestSize`): 손실 한도(총 자산 × %) ÷ |기준가 − 손절|, ADD는 기존 리스크를 뺀 여유만. 코인 소수 6자리·주식 1주 내림, `MARGIN_HEAVY`(증거금 > 총 자산 50%). 총 자산 없거나 기존 손절 없는 ADD(`NO_STOP_ON_POSITION`)는 제안 없음
  - 모델 입력(`data/project.ts`): `POSITION_ROLES`(BLITZ·GUARD·ACE·RISKY·SAFE·NEUTRAL·PM)에만 `RoleInput.position`(`positionInput()`: 비율·가격·보유 시간, 수량·총 자산·메모·청산가 없음). 압축하지 않는다. `/floor`는 `inputs/<stepId>.json`으로 같은 투영을 받고, 훅이 `.floor/` 읽기를 막는다
  - 표시(`rules/display.ts` `panelView`): 유지·추가 진입 검토·일부 청산 검토 (N%)·전량 청산 검토, 톤 `caution`(REDUCE·EXIT·위험 경고), 강한 경고는 notes 맨 앞, 강제 방향 `포지션 무시 시뮬레이션`, 데이터 부족+보유 `포지션은 그대로이며 판정이 없음`

## HTTP 서버 (src/server, src/web)
- `npm start` = `node src/server/main.ts [--lan] [--port N] [--enable-project-zip] [--lan-allow-analyze]`. 기본 `127.0.0.1:8000`(`PORT` 환경변수), LAN은 `--lan` 또는 `FLOOR_LAN=1` → `0.0.0.0` 바인딩 + 사설 IPv4 인터페이스로 들어온 연결만 받음(`connection` 이벤트에서 `allowedLocalAddress`). 사설 주소가 없으면 시작하지 않음
  - `startServer(argv, env, out, deps)`: `manager.recover()`(web 작업만 INTERRUPTED, 리포트 repair, 임시 파일 정리) → `app.listen()` → 안내 출력. 로컬 토큰 주소(`localUrl()`)와 LAN 토큰 주소는 서버 창에만 한 번. 서버 창 `l`+Enter 로컬 토큰 재발급, `r`+Enter LAN 토큰 재발급, Ctrl+C는 실행 중 분석 취소 뒤 종료. `--open`은 로컬 토큰 주소로 기본 브라우저를 연다(`openBrowser`, 셸 없이: macOS `open`, Windows `rundll32 url.dll,FileProtocolHandler`, 그 밖 `xdg-open`)
- `security.ts`(순수): `TokenAuth`(= `LanAuth`, 128비트 토큰, 재발급 시 세션 전부 무효, 세션 200개 상한. LAN은 2시간·세션 만료 = 토큰 만료, 로컬은 `ttlMs: null`로 서버 실행 동안·쿠키 Max-Age 없음), 쿠키 `floor_local`(로컬)·`floor_lan`(LAN)과 `sessionCookie`, `checkFetchSite`(P0-7-R10), `isPrivateIPv4`, `allowedLocalAddress`, `allowedHosts`/`checkHost`/`checkOrigin`, `decideAccess`(접근 등급 public·read·analyze·local. 루프백은 로컬 세션 필요), `RateLimiter`, `redact`(sk-ant-, 토큰·쿠키, `?t=`, 홈 경로 사용자 이름)
- `app.ts` `createApp(opts)`: 요청 검사 순서 Host → 교차 사이트 차단(`Sec-Fetch-Site`, `/` 페이지 이동만 예외) → 요청 수(모두 120/분) → `/?t=` 첫 접속(루프백은 로컬 토큰, 다른 기기는 LAN 토큰 → 쿠키 발급 + 302) → 경로 표(없으면 404) → 접근 등급 → Origin(GET 외) → 분석 실행 수(3/분). 경로 표 = P0 명세 v0.9 7.4절. 부작용 있는 경로(진단 실행 `POST /diagnostics`·`/api/diagnostics`, `POST /reports/all.zip`, `POST /project.zip` 폼 `confirm=`)는 POST만, `GET /diagnostics`는 실행 버튼만. 모든 응답에 CSP·nosniff·Referrer-Policy same-origin(no-referrer는 폼 POST의 Origin을 null로 만든다)·no-store·CORP/COOP same-origin. 자원 상한 `LIMITS`(동시 연결 256, SSE IP당 8·전체 64, 헤더 15초·요청 30초). ZIP은 `ZipWriter`로 흘려 쓰고 한 번에 하나
  - 테스트는 `clientIp` 옵션으로 LAN 기기를 흉내 낸다 (`x-test-ip` 헤더, 운영 코드는 소켓 주소만). `test/server/app.test.ts`의 `start()`는 로컬 토큰으로 먼저 로그인하고 `req`에 그 쿠키를 붙인다(`cookie: ''`이면 쿠키 없이)
- `jobs.ts` `JobManager`: `start({symbol, mode, idempotencyKey, demo})` → started | busy(409) | rejected(400·503). 입력은 `normalizeSymbolInput`·모드 열거형 그대로(별칭 없음)·키 `[A-Za-z0-9_-]{8,64}`. 같은 키는 진행 중 약속 → 키 색인(처음 한 번 작업 기록을 훑어 만듦) 순서로 찾는다. 슬롯은 Claude 확인 전에 동기적으로 예약. `cancel`·`cancelAll`·`idle`·`view`·`snapshot`·`subscribe`
  - 이벤트: 작업 기록이 저장될 때마다 `{type:'job', job: JobView}`, 역할 호출 `{type:'call', phase:'start'|'end', role, ...}`, 끝 `{type:'end', state}`. SSE는 구독 → 현재 보기 → (끝났으면 바로 end)
  - `view.ts` `jobView`: PID·절대 경로 없음, 오류 상세는 홈 경로 가림, E-CLI-MISSING·E-AUTH·E-CLOCK이면 `hint: '/diagnostics'`, `panel`(panelView), `reportUrl`
- `pages.ts`: 서버가 그리는 HTML(리포트 목록·열람, 진단, project.zip 확인, 스타일 `src/web/app.css`). `html` 태그 템플릿이 모든 값을 이스케이프. 리포트 본문은 `markdown.ts` `markdownToHtml`(모든 글자를 먼저 이스케이프하고 자기 태그만 넣음, 링크는 http·https + `rel="noopener noreferrer"`, 이미지는 `[이미지: …]` 글자)
- `zip.ts` 의존성 없는 ZIP(deflate, UTF-8 이름, ZIP64 없음): `ZipWriter`(스트리밍·비동기)와 `buildZip`(작은 것). `bundle.ts` project.zip: `BUNDLE_INCLUDE`(넣을 최상위 항목) 안에서 `isExcluded`(비밀 이름, P1 명세 v0.3 R14) 제외, 목록 해시는 경로·크기·수정 시각
- `board.ts` `BoardService.get(symbol, demo)` → `GET /api/board`: 레지스트리 해석(미국 주식 조회 포함) → 종목별 15초 캐시(동시 요청은 한 약속으로 묶음, 64종목 상한) → `core/board.ts`. 데모는 manifest의 algorithm 시나리오 기록만 쓰고 네트워크 클라이언트를 쓰지 않는다
  - `core/board.ts`: `collectBoardSources(net, inst)`(가격·일봉, 한국 종목은 환율·Binance 무기한+펀딩·다른 거래소 무기한. 뉴스·심리·CoinGecko 없음) → `buildBoard(inst, records, now, demo)`(순수: 가격·직전 종가 대비 등락(주식 장 마감 뒤는 전 거래일), 일봉 120개 + MA20/MA50 + 20봉 고저, 멀티 거래소 `multi`(추정값 `BOARD_ESTIMATE_BADGE`·산출 거래소·시각, 괴리))
- `src/web/` 픽셀 화면 (가이드 4장): `index.html`·`floor.css`·`floor.js`(DOM·API·SSE)·`model.js`(순수 표시 모델, `test/web/model.test.ts`)·`sprites.js`(글자 지도 → 캔버스 캐릭터)·`chart.js`(8비트 차트). 서버 페이지는 `app.css`
  - 표시 규칙은 `model.js`에 모은다: `floorPlan(mode)`(스캘핑·강제 방향은 리스크 방이 스캘핑 데스크, PM 자리 없음), `panelModel`(COMPLETED·INSUFFICIENT_DATA만, 서버 `panelView` + DEMO 배지 + 화면 시각 만료), `consoleEntries`(수집 로그 → 뉴스 → 브리핑 → 토론 → 계획·심사 → 최종), `bubbles`, `multiRows`, `planLabel`, `FORCED_CONFIRM`, `DATA_FLOW`(P0 명세 6.2 문안)
  - 모든 글자는 `textContent`로만 넣는다. `innerHTML`·`insertAdjacentHTML`·`eval` 등은 테스트가 파일을 읽어 금지한다(P1-7-T2). 링크는 서버가 준 경로(`reportUrl`, `/diagnostics`)만
  - 강제 방향: URL·저장값으로 모드를 고르지 않는다(`initialMode`는 항상 algorithm). 확인 여부만 `sessionStorage`(`floor.forcedConfirmed`), `localStorage`는 쓰지 않는다
  - API가 401이면 상단에 "서버 창에 표시된 주소로 다시 여세요" (이슈 #11의 로컬 토큰 도입 대비)
- `/api/positions`(GET·PUT): access `local`(LAN 기기 403), PUT은 기존 Origin·Sec-Fetch-Site·JSON Content-Type 검사. 웹 `position.js`(순수: 폼 ↔ 포지션 변환·필드 오류·상단 요약·보유 표시·오래된 보유 경고, `test/web/position.test.ts`)
- 테스트 도구: `test/server/server-helpers.ts`의 `manager()`(녹화 데이터 + autoDriver), `test/server/zip-reader.ts`의 `readZip`
