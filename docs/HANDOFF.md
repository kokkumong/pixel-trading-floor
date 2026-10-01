# 진행 상황과 인계

`/next-phase`가 읽고 갱신한다. 버전 이름을 붙이지 않고 제자리에서 고친다.
범위: P0와 P1 전체 (보완안 14.2 릴리스 게이트)는 Phase 10으로 완료. Phase 11부터는 P2 포지션 (`docs/PIXEL-TRADING-FLOOR-P2-포지션-명세-v*.md` 10장). 각 Phase는 명세 검증 ID를 통과 기준으로 하고, `npm run verify` 통과 후 커밋한다.
Phase 하나 = 이슈 하나 = PR 하나. 세션은 구현 세션과 마무리 세션으로 나눈다 (`.claude/skills/next-phase/SKILL.md`).

## 진행표

| Phase | 내용 | 상태 |
|---|---|---|
| 0 | 골격, claude -p 스파이크 | ✅ |
| 1 | 스키마 DSL, 규칙 엔진, 표시 규칙 (`src/core/schema`, `src/core/rules`) | ✅ |
| 2 | 레지스트리, 달력, 지표, 공급자 어댑터, 스냅샷, 역할별 입력 (`src/core/data`) | ✅ |
| 3 | claude 드라이버, 오류 코드, 예산, 재시도 (`src/core/model`, `src/core/job/budget.ts`, `retry.ts`) | ✅ |
| 4 | 작업 엔진과 역할 프롬프트 (`src/core/job`, `src/core/prompts`) | ✅ |
| 5 | 리포트(JSON 원본 + MD), CLI 6개 명령(analyze·snapshot·next·submit·finalize·doctor), 데모 fixture → M1 | ✅ |
| 6 | HTTP 서버와 보안 경계 (P0-7, P1-7, SSE, zip, /diagnostics) | ✅ |
| 7 | 픽셀 UI (가이드 PDF 화면 구성), 전광판 API, 리포트 Markdown 렌더러 | ✅ |
| 8 | `/floor` 명령(스킬+하위 에이전트+도구 제한 훅), 시작 스크립트, 가이드 v1.3(Markdown), P1-11 실측 도구 | ✅ |
| 9 | 근거 인용 검사(P1-10-R1·R3·R5, 화면·리포트 경고), job.json CLI 버전(P1-11-R3) | ✅ |
| 10 | 데모 fixture 정리(근거 검사 경고 0건), 강제 방향 BTC 데모 fixture, 가이드 v1.5 | ✅ |
| 11 | P2 포지션 명세(`P2-포지션-명세`), P0 D3 폐기(P0 v0.10, 보완안 v1.3) | ✅ |
| 12 | 포지션 북 스키마·검증·저장(`.floor/positions.json`)·API, 입력 화면, 파생 값 (P2-1, P2-5-T1) | ✅ |
| 13 | 행동 집합 확장·스키마 v3·규칙 엔진·수량 제안·프롬프트·역할별 입력·`/floor` 투영 (P2-2·3·4) | ✅ |
| 14 | 리포트·화면 표기·고지·마스킹·LAN·데모 fixture (P2-5·6·8) | ✅ |
| 15 | macOS·Windows 시작 파일, 시작 시 doctor, 가이드 v1.6 (P2-7, P2-6-R5) → **P2 구현 끝** | ✅ |
| 16 | P3 신규 진입 명세(`P3-신규진입-명세`): 진입 시나리오 카드·분할 진입·NO_TRADE 후속 안내 | ✅ |
| 17 | 스키마 v4(`proposal/4`·`decision/4`), 시나리오·분할 규칙, 파생 값(손익비·tranche 수량), 이전 버전 읽기 호환 (P3-1-T1~T4, P3-3, P3-4) | ✅ |
| 18 | ACE·BLITZ·PM 프롬프트·`/floor` 투영, 리포트·화면 카드·마스킹, 데모 fixture, 가이드 개정 (P3-2, P3-5, P3-6) → **P3 구현 끝** | ✅ |
| 19 | Electron 스파이크(타입 제거 실행·asar·`claude` 경로 실측)와 P4 명세 (`P4-데스크톱앱-명세`). 데스크톱 셸은 `desktop/` 하위 패키지로 분리, 루트 런타임 의존성 0개 유지 | ✅ |
| 20 | **데스크톱 셸: 메인 프로세스, 서버 기동·종료, 창 보안 설정, 단일 인스턴스, `FLOOR_HOME`=앱 데이터 폴더** (P4-1·2·4) | 다음 |
| 21 | `claude` 탐색·PATH 보강·안내 대화상자·시작 doctor 연동 (순수 함수로 루트 테스트, P4-3) | 대기 |
| 22 | 패키징: 맥 `.dmg`(arm64·x64), 아이콘, GitHub Actions. 윈도우 설치 파일은 빌드만 | 대기 |
| 23 | 가이드 v1.9(지인용 설치·서명 없는 앱 경고·데이터 이관)와 맥 실기 스모크 → **P4 맥 끝**. 윈도우 실기 확인은 그 뒤 | 대기 |

## 진행 중 (세션 인계)

<!-- Phase 도중 세션을 나눌 때만 채운다. 형식은 next-phase 스킬 "중간 인계" 참고. PR 병합 전에 "Phase N+1 참고"로 옮기고 "없음"으로 되돌린다 -->
없음

## Phase 20 참고 (P4 데스크톱 앱)
Phase 19(이슈 #43)로 `desktop/`(Electron 44.5.1 스파이크 `main.cjs`)와 `docs/PIXEL-TRADING-FLOOR-P4-데스크톱앱-명세-v0.1.md`를 만들었다. 실측과 결정은 그 명세 0장.
- 이어서 할 일(Phase 20): `desktop/main.cjs`를 스파이크에서 정식 셸로 바꾼다 — 단일 인스턴스, 창 보안 설정(P4-4-R1·R2), 종료 처리(P4-1-R5), 편집 메뉴, `FLOOR_HOME`=`userData/data`(P4-2-R1). 테스트할 수 있는 판단(주소 허용·경로 검사·`webPreferences` 객체)은 Electron 없이 import되는 순수 모듈로 빼서 루트 `test/`에서 검증한다(P4-1-R2). 정확한 위치는 `[구현 시 결정]`(예: `desktop/lib/*.cjs`나 `src/desktop/*.ts` 중 루트 `tsc`가 검사할 수 있는 쪽)
- 보안 수칙(사용자 제시 11개)은 P4 명세 4장 대조표가 기준이다. 스파이크 `desktop/main.cjs`·`preload.cjs`는 A1~A6을 이미 구현·실행 확인했다(창 `require`·`process` 없음, `window.open` null, 카메라·알림·위치·클립보드 거부, 외부 이동 차단). Phase 20은 `openExternalSafe`(R10)·`openDataFolder`·`getClaudeStatus`(R7)·URL 스킴 미등록(R11)을 정식 구현한다. **App Sandbox는 쓰지 않기로 했다(D9, 사용자 결정)**
- 실행 방법(개발): `cd desktop && npm install && node node_modules/electron/install.js` 한 번, 이후 `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron desktop`(저장소 루트에서). Electron 44는 `npm install`만으로는 바이너리를 받지 않는다
- 스파이크 확인값: Node 24.21 내장·`.ts` 로드·`app.asar` 안 로드·짧은 PATH에서 claude 탐색 모두 통과(맥 arm64). 윈도우 `.cmd` claude는 `process.execPath`가 Electron이라 별도 처리 필요(P4-3-R5)
- 맥 먼저, 윈도우는 맥 뒤(사용자 결정 2026-10-01). 중복 파일 `start-floor 2.cmd`·`start-floor-lan 2.cmd`·`.gitattributes 2`는 사용자가 삭제 여부를 정하지 않았다(untracked, 건드리지 않음)

## P3 구현 완료 후 참고 (개발 Phase 없음)
Phase 18(이슈 #41)로 P3 신규 진입(진입 시나리오·분할 진입·관망 후속 안내) 구현이 끝났다. P3 개발 Phase는 없다. 다음 작업은 P4 데스크톱 앱(Electron, Phase 19~23, 이슈 #43부터)이다. 맥 먼저, 윈도우는 맥 뒤에 한다 (사용자 결정 2026-10-01).
- 다음 논의 후보: macOS .app/.dmg 지인 배포(P3 구현 뒤 재개하기로 함), P1-11 본 측정(조합별 10회 이상), 아래 "남은 불확실성"
- 쓸 파일: `src/core/rules/entryplan.ts`(규칙·계산), `src/core/rules/entryview.ts`(`entryPlanView` — 화면·리포트·CLI 공용 문구), `src/core/prompts/shared/scenarios.md`, `src/core/position/mask.ts`, `fixtures/demo/v1/manifest.json`의 `entryScenarios`, 테스트 `test/core/entry-plan.test.ts`·`entry-view.test.ts`, `test/job-helpers.ts`의 `sampleScenario`
- Phase 17 결정 (유지):
  - 시나리오·분할의 **구조**는 스키마가 검사(`SCHEMA_ERROR` 재시도), **개수·기하·트리거·레버리지**는 규칙이 검사해 해당 항목만 제거(D31). `scenarios`·`tranches`가 없는 출력은 `[]`·`null`로 읽는다
  - 모델 원본은 `proposal`, 규칙 통과 결과는 `decision.entryPlan`. 화면·리포트는 `entryPlan`만 읽는다. 보유·강제 방향·데이터 부족은 `entryPlan = null`
  - 경고는 `entryPlan.warnings`(`NO_WAIT_PLAN`·`SCN_DROPPED`·`TRANCHE_DROPPED`·`NO_EQUITY`)와 시나리오별 `warnings`에만 둔다(`ruleEngine.warnings`에는 없음)
  - ATR은 스냅샷의 `atr14` 하나. 기준 진입가: 분할이 있으면 가중 평균, 없으면 구간의 불리한 쪽. PM 기각은 빈 계획 + `NO_WAIT_PLAN`
- Phase 18 결정:
  - 프롬프트: 보유 없는 비강제 작업의 ACE·BLITZ·PM에만 `shared/scenarios.md`를 붙인다. 보유·강제 방향의 ACE·BLITZ JSON 스키마에서는 `scenarios`·`tranches`를 뺀다. PM `revisedProposal` 스키마는 좁히지 않았다
  - 분석가·토론·GUARD·위험 토론 프롬프트 해시를 `test/core/prompts.test.ts`의 `P2_HASHES`에 고정했다. **이 역할 프롬프트를 일부러 바꾸면 그 표도 갱신한다**
  - `조건 미충족` 문구는 시나리오 카드에만 붙는다(지금 진입안의 분할 표에는 없음). `NO_EQUITY` 안내는 카드나 분할 표가 있을 때만. 만료는 화면이 `validUntil`과 화면 시각으로 판단한다(데모는 녹화 시각이 지나 `만료됨`으로 보인다)
  - `규칙에 의해 모델 제안이 조정됨`은 보유 없는 판정에서는 모델이 시나리오를 쓴 강등(DOWNGRADED)에만 붙는다
  - LAN 마스킹: `maskJobView`가 최상위 `sizing`이 없어도 `entryPlan`이 있으면 가리고, 패널 카드는 가린 판정에서 다시 만든다(이전에는 `NO_TRADE` + 시나리오 수량이 샜다)
  - 근거 검사: 시나리오 `evidenceRefs`가 없으면 `NO_SCENARIO_REF`, 없는 참조는 `UNRESOLVED_REF`(경고만). BLITZ·ACE·PM 수정안에 같은 시나리오가 있으면 경고가 중복될 수 있다
  - 리포트 `reportSchemaVersion` 3 (store는 1~3을 읽는다)
  - 데모: `entryScenarios`(`btc-wait`·`btc-split`·`btc-short-alt`)는 기본 데모의 ACE·PM(분할은 RISKY·SAFE·NEUTRAL 해석 주장도)만 바꾼 손으로 쓴 fixture다. 북은 보유 0건·총 자산 10,000 USDT. 기본 데모 두 개(알고리즘 PM 기각, 스캘핑 ACE 관망)는 시나리오가 없어 `재진입 조건이 제시되지 않음`이 보인다
- 남은 불확실성 (P3 명세 9.1): 시나리오 남발 여부, `5×ATR`·`0.2×ATR`·손익비 1.5·겹침 50% 임계값은 스모크 2건만 본 값이다. 실전 분석이 쌓이면 `entryPlan.dropped` 사유 분포를 보고 조정한다. 분할 진입(`tranches`)은 스모크에서 모델이 쓰지 않아 실전 출력은 아직 확인하지 못했다
- P3 실전 스모크 6건(2026-10-01, 이슈 #45, 수치는 "실측 기록"): 시나리오 남발 없음(전부 주 1건), 임계값(`5×ATR`·`0.2×ATR`·겹침 50%)에 걸린 시나리오 0건, 손익비 1.5 미만 1건. 임계값을 조정할 근거는 아직 없다
  - `VALUE_MISMATCH` 3건은 모두 TARO의 observation `c3`이고 수치 오기가 아니다. 본문 숫자(개별 봉 시가·종가, 횡보 구간 경계)는 입력 봉 데이터에 실제로 있는 값인데, 인용한 요약 참조(`derived:recentLow20`, `snap:…price#/last`)의 값은 본문에 쓰지 않았다. 검사(`src/core/rules/audit.ts`)는 참조 값과 맞는 숫자가 없고 ±1% 안의 숫자만 있으면 잘못 옮긴 것으로 보므로, 봉 값이 참조 값 근처일 때 경고가 난다(83889.7↔83360, 85000↔84288.2, 2698↔2679.64)
  - 후속 후보(미착수): TARO 프롬프트에 "인용한 참조의 값을 본문에 그대로 적고, 봉 값을 말할 때는 해당 봉 참조를 인용" 추가(해시 표 `P2_HASHES` 갱신 필요), 또는 검사에서 본문 숫자가 입력 봉 값과 일치하면 후보에서 제외
  - 총 자산은 통화별(`KRW`·`USD`·`USDT`)이다. 암호화폐 분석에서 수량까지 보려면 USDT를 넣어야 한다
- 미뤄진 항목: 데모 카드가 항상 `만료됨`으로 보이는 점(기본 데모의 `만료` 배지와 같은 원인), 기본 데모 fixture에 시나리오 추가

## UI 개선 (이슈 #35, 개발 Phase 없음)
- 방 벽 소품(`sprites.js drawProp`, `model.js ROOM_PROPS`), 분석 전 말풍선 `분석 대기 중…`, 하단 티커 띠 `GET /api/ticker`(30초, 표시 전용, 데모는 숨김). 명세 P0 v0.11 7.4·P0-7-T10, 가이드 v1.7 4-2·4-3-1
- 티커 종목은 `src/core/ticker.ts`의 `TICKER_ITEMS`에서 고친다 (코인 4·미국 지수 3·한국 지수 2·한국 종목 4·미국 종목 6). Yahoo 요청이 종목 수만큼 나가므로 늘릴 때 30초 캐시와 속도 제한을 함께 본다
- 데모 녹화(2026-09-29)가 유효 기한을 넘겨 `P0-3-R5` 테스트가 날짜 때문에 깨졌던 것을 고침(서버가 붙인 만료 배지를 빼고 비교). 데모 화면 판정 패널에 `만료` 배지가 뜨는 것은 그대로다 — 녹화 시각 기준으로 다시 볼지는 미결

## Phase 15 결과와 P2 이후 참고 (개발 Phase 없음)
P2(Phase 11~15) 구현은 끝났다. 남은 것은 사용자가 하거나 선택하는 일이다.
- 미확인: P2-7-T1 Finder 더블클릭(`start-floor.command`를 Finder에서 열어 시작 점검 표시·브라우저 열림 확인). 셸 수준 확인만 했다(`env -i PATH=/usr/bin:/bin`으로 실행 → node@22 탐색, 시작 점검, 서버 시작, 브라우저 열림). Windows 시작 파일은 Node 버전 검사식을 테스트로만 확인했고 실기 확인은 없다
- 선택: 실제 스모크 — 북에 BTC 무기한 보유를 넣고 `node src/cli/floor.ts analyze BTC scalp` → 포지션 행동으로 완료되는지, 호출 수·시간·비용 기록. 가이드 스크린샷은 없다(가이드는 Markdown 텍스트)
- Phase 15 결정 (유지):
  - 시작 점검은 서버 `--doctor` 한 곳에 두고 두 OS 시작 파일이 같이 쓴다. `[오류]`여도 서버는 켠다. Node 없음·22.18 미만은 서버가 TS를 못 돌리므로 시작 파일(셸)이 먼저 거른다
  - macOS node 탐색 순서·`FLOOR_NODE_SEARCH`·zip mode는 ARCHITECTURE.md "리포트·데모·진단·CLI" 절
  - 표지 문구는 "분석 도구 (실제 주문 기능 없음)". 프롬프트 `shared/common.md`의 "분석 시뮬레이션"은 모델 입력이라 그대로
  - 가이드 v1.6: 보유 포지션 입력·판정·수량 제안 한계·모델로 보내는 정보(비율만)·저장 위치, macOS 설치·시작 파일, 시작 점검
  - 데모 화면에서는 `보유 포지션` 버튼을 숨긴다(데모는 포지션 북을 읽지 않음)
  - `.claude/launch.json`에 `autoPort`(8000번이 사용 중이면 다른 포트)
- 알려진 것: 짧은 PATH에서는 `~/.claude/local`의 오래된 claude가 먼저 잡혀 시작 점검이 `[오류] Claude CLI 버전`을 낸다(안내 문구가 제대로 뜨는 실례)
- 실측: 시작 점검 0.4초(이 Mac, 모델 호출 0회). 실제 claude 스모크는 안 함
- Phase 14 통과 기준: P2-5-T2·P2-5-T3·P2-6-T1·P2-6-T2·P2-6-R3·P2-2-R4 `test/core/position-report.test.ts`, P2-5-T3(LAN·SSE·리포트·all.zip·project.zip) `test/server/app.test.ts` 끝, P2-8-T1 `test/core/demo.test.ts`, P2-8-R1 `test/server/jobs.test.ts`
- Phase 14 결정 (유지):
  - 표시: `panelView(d, now, pc)`의 `PanelView.position`(판정에 쓴 포지션 요약: 시장·방향·레버리지·평단·수익률(레버리지 반영)·손절·청산가·`기준 <book.updatedAt>`, 수량·총 자산 없음, `d.positionRef === pc.position.id`일 때만)과 `disclaimer`(`DISCLAIMER`, 모든 패널·리포트). NO_TRADE 주석은 북을 읽었고 보유 없음이면 `NO_POSITION_BIAS_NOTE`, 북 없음·오류·이전 작업은 `BIAS_NOTE` — 명세 P2-6-R3을 "상황에 맞는 문구"로 해석
  - 리포트 v2(`reportSchemaVersion: 2`, `positionContext?`), store는 1·2 읽음. Markdown: 제목 아래 고지, `### 보유 포지션`(요약·판정 뒤 손절/목표/청산 비율·수량 계산 조건·컨텍스트 notes), 끝줄 고지 + "이 앱에는 주문 기능이 없습니다". 총 자산·손실 한도 금액은 Markdown에 없음
  - 마스킹(`src/core/position/mask.ts`, `[masked]`): sizing의 수량·손실 한도·기존 리스크·여유·증거금, `positionContext.account` 통째, `position.quantity`. 가격·비율은 남김. 원본 파일은 그대로, LAN 응답(작업 보기·분석 시작 응답·SSE·리포트 JSON/MD/HTML)과 `all.zip`(항상)만 가린 사본. 가리지 않는 내보내기는 두지 않음
  - 진단: `positionCheck(read)` → "포지션 N건 저장됨"·"저장된 포지션 없음"·"파일 오류"(오류 내용 없음). 서버·CLI doctor 모두 연결
  - 포지션 데모: manifest `positionScenarios`(`btc-hold` scalp HOLD, `btc-reduce` algorithm 현물 REDUCE 50% PM 승인, `btc-exit` scalp 20배 청산가 근접 EXIT), 파일 `<이름>.responses.json`·`<이름>.positions.json`(가짜 북), 스냅샷은 기존 fixture 재사용. 엔진 `demoPositions`(데모는 `positions`를 부르지 않음). 선택: `JobManager.start({demoScenario})`(데모·같은 모드·`[a-z0-9-]`만), CLI `analyze BTC scalp --demo --scenario btc-hold`, `/api/status`의 `demoScenarios`, 웹 데모의 "보유 예시" 선택
- Phase 13 결정 요약: 행동 = `ENTRY_ACTIONS` + `POSITION_ACTIONS`, `proposal/3`·`decision/3`, 보유 중 강등은 HOLD, 수량은 `rules/sizing.ts`, 모델 입력은 `POSITION_ROLES`에만 비율 투영, 프롬프트 `shared/position*.md`. 자세한 내용은 `docs/ARCHITECTURE.md` 포지션 절
- Phase 12 결정 요약: 포지션 북 `positions/1`, 저장 `.floor/` 0700·파일 0600·`.bak`, `/api/positions`는 local 전용, 웹 순수 함수 `src/web/position.js`

## P1 구현 완료 후 남은 일 (개발 Phase 없음)
구현 범위(P0·P1)는 Phase 10으로 끝났다. 아래는 사용자가 하거나 선택하는 일이다.
- 남은 항목:
  1. P1-11 본 측정: 조합별 10회 이상·시간대 분산·Windows에서 `node scripts/measure-budget.ts run <종목> <모드> --count N` → `report [--interface floor]`로 p99×1.5 산출, 명세 부록 기록(P1-11-R1·T1·T2). 표본 10건 미만이면 상한에 적용하지 않는다. 실제 claude 반복 실행이라 사용자가 돌린다. job.json에 `claudeCliVersion`이 기록되므로 실측 요약이 버전 혼재·미기록을 재측정 대상으로 표시한다
  2. (완료, Phase 10) 데모 fixture 정리: RISKY의 `brief:ACE#rationale` 참조 제거, SAFE 문장에서 어긋난 가격 숫자 제거, 강제 방향 데모 `btc-forced`(scalp 스냅샷 복사 + ACE 롱·`unforcedAction` NO_TRADE 손작성). 테스트 P1-10-T2가 모든 데모 모드의 경고 0건을 지킨다
  3. 선택: 하단 시세 흐름 띠, CoinGecko 403 원인, ±1%보다 크게 틀린 수치 불일치 검출(현재 한계)
  4. 미검증: Windows `taskkill` 트리 종료(P0-8-R6), `.cmd` 실행(P1-7-R4), Windows `--open`의 `rundll32`, 시작 스크립트 실기 확인
- Phase 9 결정 (유지):
  - `auditEvidence`(`src/core/rules/audit.ts`)는 경고만 남기고 판정은 바꾸지 않는다. 종류 `UNRESOLVED_REF`·`VALUE_MISMATCH`·`NO_BRIEF_REF`·`UNSOURCED_NUMBER`. 오탐 줄이기 규칙과 흐름은 ARCHITECTURE.md "작업 엔진" 절. 제출마다 전체 재계산 → `job.json evidenceAudit` → `JobView` → 리포트 JSON(스키마 버전 그대로, 필드 추가) → Markdown·화면 꼬리표
  - 공통 프롬프트에 "제안서(ACE·BLITZ·PM)는 `brief:` 참조 대상이 아님"을 추가해 모든 역할 프롬프트 해시가 바뀌었다(본 측정 전이라 무방). 본 측정은 이 해시 이후 작업만 쓴다
  - `claudeCliVersion`은 `??=`로 처음 값만 기록, /floor는 finalize 때 기록(중간 실패 작업은 null). 실측 부록 표에 `CLI` 열
  - 가이드는 v1.4(4-3절에 근거 검사 표시 설명)
- Phase 8 결정 (유지):
  - `/floor`는 스킬(`context: fork`, `agent: floor-session`)이고, **스킬 frontmatter의 `hooks`는 포크된 문맥에 걸리지 않는다**(Claude Code 2.1.284 스모크). 그래서 도구 제한은 하위 에이전트 정의(`tools: Bash, Read, Write` + PreToolUse 훅 `scripts/floor-guard.ts`)가 한다. 훅 규칙은 ARCHITECTURE.md "리포트·데모·진단·CLI" 절
  - `$ARGUMENTS`는 인용부호 안에 넣지 말고 "이번 요청" 절에 원문으로 둔다(모델이 "인자 없음"으로 멈춘 적 있음)
  - 가이드는 Markdown(`docs/PIXEL-TRADING-FLOOR-가이드-v1.*.md`(최신 파일은 `ls docs/`))으로 전환했고 PDF는 삭제(사용자 결정 2026-09-30). 개정은 명세와 같이 파일 rename + 개정 이력 한 줄. 화면 캡처는 없다
  - P1-11은 도구 + 소표본만(사용자 결정 2026-09-30)
- 이전 결정 (Phase 7 이하, 유지): 전광판 종목별 15초 서버 캐시 + 화면 15초 갱신, 등락은 직전 완성 봉 종가 기준. 강제 방향 확인은 ANALYZE를 누를 때. 데모 전광판은 `BTC`만. 확신도는 3단계만(숫자는 리포트에만). 웹 JS는 `tsconfig.web.json`(checkJs)으로 검사. 시작 스크립트는 `node src/server/main.ts --open`(서버가 로컬 토큰 주소를 열고 주소를 파일로 남기지 않음), LAN은 `--lan --open`. LAN HTTPS 미도입(사용자, 2026-09-29): 평문 HTTP·읽기 전용·2시간 토큰·신뢰 네트워크 경고. 수동 보안 스모크: `node scripts/security-smoke.ts tools|inject|inject-only`
- 알려진 한계: 서버 시작 순간 별도 프로세스의 `floor.ts analyze`가 돌고 있으면 그 작업도 INTERRUPTED. macOS 기본 `unzip`은 UTF-8 파일명을 `?`로 보임. 픽셀 폰트는 PC에 `DungGeunMo`·`Galmuri11`이 있으면 쓰고 없으면 고정폭 글꼴
- 확인용: `npm start` → 서버가 여는 토큰 주소에서 `/?demo=1`, 실전 전광판은 `하이닉스` 입력, `node --test "test/web/*.test.ts" "test/server/*.test.ts"`. 브라우저 미리보기는 `.claude/launch.json`의 `floor`

## 실측 기록

- 실측(sonnet `claude-sonnet-5-5`, P3 실전 스모크 6건, 2026-10-01, 이슈 #45, 구독 로그인, CLI 2.1.285, 북은 SOXL 1건·총 자산 USD만 입력): 6건 모두 `COMPLETED`·관망(`NO_TRADE`, `NO_EDGE`, 확신도 LOW)·재시도 0·주 시나리오(롱) 1건·대안 0건·제외(`dropped`) 0건·분할(`tranches`) 0건·`NO_EQUITY`(USDT 총 자산 미입력이라 수량 미계산). 비용은 CLI 보고 값 합계
  - BTC scalp 56.8초·호출 5·$0.170·ACE·손익비 1.65·근거 경고 1 / BTC algorithm 111.8초·호출 13·$0.397·PM 수정·손익비 1.58·근거 경고 1
  - ETH scalp 54.1초·호출 5·$0.163·ACE·손익비 1.27(`LOW_REWARD_RISK`)·근거 경고 1 / ETH algorithm 100.6초·호출 13·$0.379·PM 수정·손익비 1.67
  - SOL scalp 60.8초·호출 5·$0.171·ACE·손익비 1.55 / SOL algorithm 94.8초·호출 13·$0.365·PM 승인·손익비 1.81
  - 같은 시각대 암호화폐 3종이라 표본이 서로 비슷하다. Phase 18 스모크 2건을 합쳐 8건 모두 관망이어서 진입 판정의 분할·제외 규칙은 아직 실전에서 보지 못했다

- 실측(sonnet, Phase 18 스모크, 시나리오 프롬프트 적용, 총 자산 미입력): BTC scalp 60.5초·호출 5·재시도 0·$0.240·ACE 관망 + 주 시나리오 1건(제외 0건, 근거 경고 0건), BTC algorithm 97.4초·호출 13·재시도 0·$0.478·PM 승인(관망) + 주 시나리오 1건(제외 0건, `LOW_REWARD_RISK` 1.35). 제안서 호출은 BLITZ 11.4초·1,576토큰, ACE 10.5~11.4초·1,587~1,749토큰, PM 7.6초·921토큰으로 상한 조정은 필요 없었다(P3-5-R4). 분할 진입은 두 번 모두 쓰지 않음
- Phase 15: 시작 점검 0.4초(이 Mac), 모델 호출 없음
- Phase 13: 모델 호출 없음(실측 없음, 스모크는 Phase 14로 미룸)
- Phase 12: 모델 호출 없음(실측 없음)
- 실측(haiku, TARO 1회, Phase 3): 기본 68.7초·출력 7,638토큰, `--effort low` 54.4초·5,143토큰 → Phase 4에서 스키마 길이 축소 (narrative 1000자, claims 최대 6개)
- 실측(sonnet, BTC scalp 5회, Phase 4 스모크): 43초, 출력 합계 6,401토큰, 보고 비용 $0.18, 재시도 0, 근거 참조 오류 0
- 실측(sonnet, BTC algorithm 13회, Phase 5 스모크 = M1): 86초, 출력 합계 약 14,300토큰, 보고 비용 $0.458, 재시도 0, 토론 2라운드, PM 기각
- 개발 세션 토큰(Opus, Phase 2~7 세션 5개, 2026-09-29 분석): 세션당 모델 호출 84~190회, 호출당 평균 문맥 21만~32만(최대 51만), 문맥 재읽기 1,710만~5,960만 토큰, 출력 12만~26만 토큰. 원인은 긴 세션·통째 읽기·스크린샷·verify 전체 출력(약 74KB) → CLAUDE.md "토큰 절약" 규칙과 세션 분할 도입 (이슈 #15)
- 실측(sonnet, `/floor BTC scalp`, Phase 8 스모크, 2회째): 78초, 보고 비용 $0.39, 도구 Bash 12·Read 15·Write 5, 웹 도구 0건, 훅 거부 0건, 결과 ACE 관망. 1회째(훅 미적용) 101초 $0.50
- 실측(sonnet, BTC 브라우저 경로 소표본, Phase 8): algorithm 2건 86~90초·호출 13·재시도 0, scalp 5건 36~43초. 산출(표본 부족, 미확정): algorithm maxDuration 111초·callTimeout 최대 19초, scalp 66초·24초
- 실측(sonnet, BTC algorithm 실전 스모크, Phase 9): 86초·호출 13·재시도 0·비용 $0.345·PM 기각(NO_TRADE)·CLI 2.1.285. evidenceAudit 1건(RISKY `brief:ACE#c1` → 프롬프트 보완). 데모 fixture: algorithm 2건, scalp 0건
- 실측(Phase 19 스파이크, 맥 arm64): Electron 44.5.1 = Node 24.21.0, `.ts` 직접 로드 가능(메인 프로세스 import·ELECTRON_RUN_AS_NODE·app.asar 안). 짧은 PATH(`/usr/bin:/bin:/usr/sbin:/sbin`)에서 `~/.local/bin/claude` 탐색 성공. 개발용 Electron.app 307MB, `app.asar`(src·config·fixtures) 2.4MB
