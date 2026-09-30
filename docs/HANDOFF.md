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
| 12 | 포지션 북 스키마·검증·저장(`.floor/positions.json`)·API, 입력 화면, 파생 값 (P2-1, P2-5-T1) | **다음** |
| 13 | 행동 집합 확장·스키마 v3·규칙 엔진·수량 제안·프롬프트·역할별 입력·`/floor` 투영 (P2-2·3·4) | |
| 14 | 리포트·화면 표기·고지·마스킹·LAN·데모 fixture (P2-5·6·8) | |
| 15 | macOS 시작 파일·시작 시 doctor·가이드 개정 (P2-7, P2-6-R5) | |

## 진행 중 (세션 인계)

<!-- Phase 도중 세션을 나눌 때만 채운다. 형식은 next-phase 스킬 "중간 인계" 참고. PR 병합 전에 "Phase N+1 참고"로 옮기고 "없음"으로 되돌린다 -->
- Phase: 12, 이슈 #25, 브랜치 `feature/25-phase12-position-book`
- 다음 단계: 구현 계속 (입력 화면) → 마무리
- 통과 기준: P2-1-T1·T2·T3·T4 ✅ `test/core/position.test.ts` / P2-1-T5 ✅ `test/server/app.test.ts` (끝의 P2 테스트 3개) / P2-5-T1 ✅ `test/core/position.test.ts` / 파생 값(3.2절) ✅ / 입력 화면(P2-1-R1 폼, R7 요약·분석 버튼 옆 보유 표시, R9 시작 화면 경고) ⬜
- 바꾼 파일: `src/core/position/{book,store,context,service}.ts`(신규), `src/core/data/project.ts`(`referencePrice` 추가), `src/core/job/{record,engine}.ts`, `src/server/{app,jobs,view}.ts`, `src/cli/floor.ts`, `test/core/position.test.ts`(신규), `test/server/{app.test,server-helpers}.ts`
- 결정:
  - `validateBook(raw, isKnown)`: 빠진 선택 필드는 기본값(null·[]·''), id 없으면 UUID 부여, `schemaVersion`·`riskPerTradePercent`(1) 기본값. 현물은 side LONG·leverage/marginMode/liquidationPrice 모두 null이어야 함. 오류는 `{path: '$.positions[i].field', message}`
  - 미국 종목 id(`US:TICKER`)는 저장 시 조회로 확인하고, 읽을 때는 형식만 본다(재시작 뒤 조회 캐시가 비어도 읽히도록)
  - PUT 본문의 포지션은 `instrumentId` 대신 `symbol`(분석 입력과 같은 글자)을 보낼 수 있다 → `resolveWithLookup(symbol, 'algorithm')`로 해석, 실패는 `$.positions[i].symbol` 오류. `updatedAt`은 서버 시각. 응답 `BookView {status: ok|missing|invalid, book, errors, names}` (`names`: instrumentId → 표시 이름). 400 응답은 `{error:'E-INPUT', message, errors}`
  - 저장: `.floor/` 0700, 임시 파일 0600 → 기존 파일을 `.bak`(0600)으로 복사 → rename
  - `PositionContext`(`position-context/1`): 매칭 포지션(메모 제외), `account {currency, equity, riskPerTradePercent}`, `price`(판정 기준 소스의 mark 우선·추정 제외), `derived`, `otherMarkets`, `warnings`(`NO_EQUITY`·`STALE_BOOK`·`BOOK_INVALID`·`NO_PRICE`), `notes`(코드가 만든 한 줄: `다른 시장 보유 있음: <이름> <현물|무기한>`, `보유 정보가 N시간 전 기준`, 파일 오류). 북이 missing이어도 컨텍스트를 만든다(보유 없음 확인). forced_direction·데모는 북을 읽지 않고 null
  - 숏 손익률은 명세의 `(평단/현재가 − 1)` 대신 `(1 − 현재가/평단)`(평단 대비 실제 손익률)로 했다. R = 단위 손익 ÷ |평단 − 손절|. 손절 거리·청산 거리는 불리한 방향 기준 %, 음수면 이미 넘음(Phase 13 V-POS-STOP-DIR에 씀). 열린 리스크는 평단 기준 손절 손실(수익권 손절이면 0). 모두 소수 둘째 자리 반올림
  - 엔진: `createEngine({positions: () => BookRead})`, `createJob` 시작에서 한 번 읽고 스냅샷 뒤 `record.positionContext`에 기록(INSUFFICIENT_DATA도). `JobView`에는 `positionNotes`만(금액 없음), `positionContext`는 넣지 않음(마스킹은 Phase 14)
  - `/api/positions`는 access `local`(LAN 기기 403), PUT은 기존 Origin·Sec-Fetch-Site·JSON Content-Type 검사를 그대로 받는다. `Route.method`에 PUT 추가
- 남은 일:
  1. 웹 입력 화면 (`src/web/`, `// @ts-check`, `textContent`만): 포지션 목록·추가/수정/삭제 폼(종목 글자·시장·방향·평단·수량·레버리지·마진·청산가·손절·목표 0~3·메모), 계좌(통화별 총 자산 KRW/USD/USDT, 손실 한도 %). 저장 = PUT 전체 교체, 400이면 `errors[].path`를 필드 옆에 표시. LAN 읽기 전용이면 입력 화면을 숨김(`/api/status`의 `client.local`). 표시 규칙은 `model.js`의 순수 함수로 두고 `test/web/model.test.ts`로 검사
  2. R7(권장): 상단 포지션 요약(종목·방향·평단·마지막 갱신)과 분석 버튼 옆 대상 종목 보유 표시(전광판 `/api/board` 응답의 instrumentId로 매칭). R9: 북 `updatedAt` 24시간 초과면 시작 화면 경고. 결과 쪽은 `JobView.positionNotes`를 판정 패널/콘솔에 한 줄로 표시
  3. 브라우저 확인(`.claude/launch.json`의 `floor`), `verify:quiet`, push → 마무리(HANDOFF 진행표·Phase 13 참고, ARCHITECTURE.md에 `src/core/position` 절 추가, CLAUDE.md 계층 지도에 한 줄)
- 실측: 없음 (Phase 12는 모델 호출 없음)

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

- 실측(haiku, TARO 1회, Phase 3): 기본 68.7초·출력 7,638토큰, `--effort low` 54.4초·5,143토큰 → Phase 4에서 스키마 길이 축소 (narrative 1000자, claims 최대 6개)
- 실측(sonnet, BTC scalp 5회, Phase 4 스모크): 43초, 출력 합계 6,401토큰, 보고 비용 $0.18, 재시도 0, 근거 참조 오류 0
- 실측(sonnet, BTC algorithm 13회, Phase 5 스모크 = M1): 86초, 출력 합계 약 14,300토큰, 보고 비용 $0.458, 재시도 0, 토론 2라운드, PM 기각
- 개발 세션 토큰(Opus, Phase 2~7 세션 5개, 2026-09-29 분석): 세션당 모델 호출 84~190회, 호출당 평균 문맥 21만~32만(최대 51만), 문맥 재읽기 1,710만~5,960만 토큰, 출력 12만~26만 토큰. 원인은 긴 세션·통째 읽기·스크린샷·verify 전체 출력(약 74KB) → CLAUDE.md "토큰 절약" 규칙과 세션 분할 도입 (이슈 #15)
- 실측(sonnet, `/floor BTC scalp`, Phase 8 스모크, 2회째): 78초, 보고 비용 $0.39, 도구 Bash 12·Read 15·Write 5, 웹 도구 0건, 훅 거부 0건, 결과 ACE 관망. 1회째(훅 미적용) 101초 $0.50
- 실측(sonnet, BTC 브라우저 경로 소표본, Phase 8): algorithm 2건 86~90초·호출 13·재시도 0, scalp 5건 36~43초. 산출(표본 부족, 미확정): algorithm maxDuration 111초·callTimeout 최대 19초, scalp 66초·24초
- 실측(sonnet, BTC algorithm 실전 스모크, Phase 9): 86초·호출 13·재시도 0·비용 $0.345·PM 기각(NO_TRADE)·CLI 2.1.285. evidenceAudit 1건(RISKY `brief:ACE#c1` → 프롬프트 보완). 데모 fixture: algorithm 2건, scalp 0건
