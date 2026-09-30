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
| **14** | **리포트·화면 표기·고지·마스킹·LAN·데모 fixture (P2-5·6·8)** | **다음** |
| 15 | macOS 시작 파일·시작 시 doctor·가이드 개정 (P2-7, P2-6-R5) | |

## 진행 중 (세션 인계)

<!-- Phase 도중 세션을 나눌 때만 채운다. 형식은 next-phase 스킬 "중간 인계" 참고. PR 병합 전에 "Phase N+1 참고"로 옮기고 "없음"으로 되돌린다 -->
없음

## Phase 14 참고
- 범위: P2 명세 5·6·8장 — 판정 패널·리포트의 포지션 요약·고지 문구(P2-6-R1~R4·R6), `JobView`·리포트·zip·LAN의 금액·수량·총 자산 마스킹(P2-5-T2·T3), 포지션 데모 fixture(P2-8-T1), 리포트 스키마 필드(P2-2-R4)
- 쓸 API·파일: `FinalDecision`(`decision/3`)의 `positionRef`·`positionPlan`·`sizing`, `record.positionContext`(`position-context/1`), `panelView()`(`src/core/rules/display.ts`)가 만드는 notes, `src/server/view.ts`(`JobView`: 지금 `positionNotes`와 `finalDecision` 전체), `src/core/report/{report,markdown}.ts`, `src/server/zip.ts`, 데모 `fixtures/demo/v1/*`·`src/core/demo.ts`
- Phase 14로 넘어온 일:
  - 마스킹: `finalDecision.sizing`(수량·손실 한도·증거금 금액)과 panelView notes의 `제안 수량 N` 줄이 지금 그대로 `JobView`·리포트에 들어간다. LAN 응답·zip은 `[masked]`로 (P2-5-T3)
  - `BIAS_NOTE`("보유 여부를 모르는 상태") → 포지션 없음이 확인된 분석에서만 알맞은 문구로 (P2-6-R3). 지금은 NO_TRADE면 항상 붙는다
  - 결과 패널에 사용한 포지션 요약(방향·평단·수익률·손절·기준 시각)과 고정 고지 문구 (P2-6-R2·R3)
  - 리포트 Markdown·JSON에 포지션 판정 필드 반영, 이전 `decision/2`·`proposal/2` 리포트 읽기 유지
  - 포지션 데모 fixture (외부 요청 0·모델 호출 0·근거 경고 0, 실제 북을 읽지 않음)
  - (선택) 실제 스모크: 북에 BTC 무기한 보유를 넣고 `node src/cli/floor.ts analyze BTC scalp` → 포지션 행동으로 완료되는지와 호출 수·시간·비용
- Phase 13 통과 기준: P2-2-T1~T3·P2-3-T1~T6·P2-4-T1~T4 모두 `test/core/position-decision.test.ts` (+ P2-2-R7 PM 기각 → HOLD). 결함 주입 10건 모두 테스트가 잡음
- Phase 13 결정 (유지):
  - 행동: `ENTRY_ACTIONS`(ENTER_LONG·ENTER_SHORT·NO_TRADE) + `POSITION_ACTIONS`(HOLD·ADD·REDUCE·EXIT) = `ACTIONS`. `ALLOWED_ACTIONS`는 모드만 보고(algorithm·scalp 7개, forced 2개), 포지션 유무는 `checkProposal`의 V-POS-STATE(행동·`positionRef`·`sizeFraction`)가 본다. `ProposalContext.positionId` 추가. 보유 판정은 `heldPosition(record)`(`record.ts`, forced는 항상 null)
  - `proposal/3`: `positionRef`(null 허용 문자열), `sizeFraction`(0.25~0.75 숫자, 정확한 값은 V-POS-STATE). `decision/3`: `positionRef`·`positionPlan{positionRef, side, stopLoss, targets, stopUpdated, sizeFraction}`·`sizing`. 이전 버전은 타입만 3이고 읽기는 런타임에서 필드가 없을 뿐(화면은 `d.positionRef` 등 falsy 처리)
  - 규칙(`rules/2`): 보유 중 강등은 HOLD(`bias`는 유지), 강등 시 계획은 기존 손절·목표로 되돌리고 수량 제안 없음. ADD는 보유 방향 ENTER로 바꿔 진입 규칙(V-BIAS·V-STOP-REQUIRED·V-DIR·V-LIQ-BUFFER·근거)을 그대로 적용. 청산가를 입력한 포지션은 단순 V-LIQ-BUFFER 대신 V-POS-LIQ-BUFFER(손절 거리 ≤ 0.5 × 현재가~청산가, ADD 차단·HOLD 경고). V-POS-LIQ-NEAR(청산 거리 < 2×ATR)는 ADD만 막고 `LIQUIDATION_NEAR` 사유. HOLD는 유효 근거 2개 + `invalidationConditions` 필수(V-EVIDENCE-REF·V-HOLD-INVALIDATION, 위반이면 DOWNGRADED로 표시)
  - 수량(`rules/sizing.ts`): 진입 기준가는 market이면 현재가(포지션 컨텍스트 가격 mark 우선), 그 외 롱 max·숏 min. 코인은 소수 6자리, 주식은 1주 단위 내림. ADD의 기존 리스크는 저장된 손절이 있을 때만 계산하고 값은 적용 손절(좁힌 값) 기준. ENTER의 수량 0은 경고만(강등 안 함), ADD의 0은 V-RISK-BUDGET → HOLD. 총 자산 없으면 제안 없음. `MARGIN_HEAVY`는 사유 코드+경고
  - 사유 코드 추가: `STOP_ALREADY_HIT`·`LIQUIDATION_NEAR`(강한 경고, 패널 notes 맨 앞), `STOP_WIDEN_IGNORED`·`NO_STOP_ON_POSITION`·`RISK_BUDGET_FULL`·`MARGIN_HEAVY`
  - 표시(`panelView`): 유지 / 추가 진입 검토 / 일부 청산 검토 (N%) / 전량 청산 검토. 새 톤 `caution`(주황, REDUCE·EXIT·경고 있는 롱). 강제 방향은 notes에 `포지션 무시 시뮬레이션`, 데이터 부족 + 보유는 `포지션은 그대로이며 판정이 없음`, EXIT는 리버설 안내, 보유 중 강등은 `규칙에 의해 모델 제안이 조정됨: <코드>`, 수량 제안은 가정과 함께 한 줄. PM 기각 제목은 보유면 `PM 기각 → 유지`
  - 모델 입력: `RoleInput.position`(`PositionInput`) 별도 블록, `POSITION_ROLES` = BLITZ·GUARD·ACE·RISKY·SAFE·NEUTRAL·PM. 필드: positionRef·marketType·side·leverage·marginMode·avgEntryPrice·stopLoss·targets·손익률 둘·rMultiple·손절/청산 거리·비중·`holdingHours`(openedAt~수집 시각)·`bookAgeHours`. 수량·총 자산·메모·청산가·열린 리스크는 없음. 압축(compact) 대상 아님
  - 프롬프트: 보유 작업이면 제안 역할(BLITZ·ACE·PM)은 `no-trade.md` 대신 `shared/position.md`, 검토 역할(GUARD·RISKY·SAFE·NEUTRAL)은 `shared/position-review.md`를 더한다. `PromptSet.systemPrompt/hash(role, mode, held)`, `jsonSchemaFor(role, mode, held)`는 행동 enum을 포지션 유무로 좁힌다(PM `revisedProposal` 스키마는 좁히지 않음 — 코드 검증만)
  - `/floor`: 훅은 이미 `jobs/<jobId>/` 밖 읽기를 막아 `.floor/`도 차단됨(테스트 추가). `next`가 쓰는 `inputs/<stepId>.json`에 같은 투영이 들어간다
- Phase 12 결정 요약: 포지션 북 `positions/1`(`validateBook`, 미국 종목은 저장 때만 조회), 저장 `.floor/` 0700·파일 0600·`.bak`, `/api/positions`는 local 전용, `PositionContext` 파생 값(숏 손익률은 `1 − 현재가/평단`, 손절·청산 거리는 불리한 방향 %, 음수면 이미 넘음), 웹 순수 함수 `src/web/position.js`. 자세한 내용은 `docs/ARCHITECTURE.md` 포지션 절

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

- Phase 13: 모델 호출 없음(실측 없음, 스모크는 Phase 14로 미룸)
- Phase 12: 모델 호출 없음(실측 없음)
- 실측(haiku, TARO 1회, Phase 3): 기본 68.7초·출력 7,638토큰, `--effort low` 54.4초·5,143토큰 → Phase 4에서 스키마 길이 축소 (narrative 1000자, claims 최대 6개)
- 실측(sonnet, BTC scalp 5회, Phase 4 스모크): 43초, 출력 합계 6,401토큰, 보고 비용 $0.18, 재시도 0, 근거 참조 오류 0
- 실측(sonnet, BTC algorithm 13회, Phase 5 스모크 = M1): 86초, 출력 합계 약 14,300토큰, 보고 비용 $0.458, 재시도 0, 토론 2라운드, PM 기각
- 개발 세션 토큰(Opus, Phase 2~7 세션 5개, 2026-09-29 분석): 세션당 모델 호출 84~190회, 호출당 평균 문맥 21만~32만(최대 51만), 문맥 재읽기 1,710만~5,960만 토큰, 출력 12만~26만 토큰. 원인은 긴 세션·통째 읽기·스크린샷·verify 전체 출력(약 74KB) → CLAUDE.md "토큰 절약" 규칙과 세션 분할 도입 (이슈 #15)
- 실측(sonnet, `/floor BTC scalp`, Phase 8 스모크, 2회째): 78초, 보고 비용 $0.39, 도구 Bash 12·Read 15·Write 5, 웹 도구 0건, 훅 거부 0건, 결과 ACE 관망. 1회째(훅 미적용) 101초 $0.50
- 실측(sonnet, BTC 브라우저 경로 소표본, Phase 8): algorithm 2건 86~90초·호출 13·재시도 0, scalp 5건 36~43초. 산출(표본 부족, 미확정): algorithm maxDuration 111초·callTimeout 최대 19초, scalp 66초·24초
- 실측(sonnet, BTC algorithm 실전 스모크, Phase 9): 86초·호출 13·재시도 0·비용 $0.345·PM 기각(NO_TRADE)·CLI 2.1.285. evidenceAudit 1건(RISKY `brief:ACE#c1` → 프롬프트 보완). 데모 fixture: algorithm 2건, scalp 0건
