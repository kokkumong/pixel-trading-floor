# 진행 상황과 인계

`/next-phase`가 읽고 갱신한다. 버전 이름을 붙이지 않고 제자리에서 고친다.
범위: P0와 P1 전체 (보완안 14.2 릴리스 게이트). 각 Phase는 명세 검증 ID를 통과 기준으로 하고, `npm run verify` 통과 후 커밋한다.
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
| **9** | **P1 잔여: P1-11 본 측정·명세 부록, P1-10-R1·R3 근거 경고 등 (제안, 범위는 다음 세션이 정한다)** | 다음 |

## 진행 중 (세션 인계)

<!-- Phase 도중 세션을 나눌 때만 채운다. 형식은 next-phase 스킬 "중간 인계" 참고. PR 병합 전에 "Phase N+1 참고"로 옮기고 "없음"으로 되돌린다 -->
- Phase: 9, 이슈 #19, 브랜치 `feature/19-phase9-evidence-audit` (push 완료, PR 없음)
- 다음 단계: 마무리
- 통과 기준: P1-10-R1 ✅ `test/core/evidence-audit.test.ts`·`test/core/job/engine.test.ts` / P1-10-T2 ✅ `evidence-audit.test.ts`·`test/core/report/report.test.ts`·`test/web/model.test.ts` / P1-10-R3 ✅ `evidence-audit.test.ts` / P1-10-R5 ✅ `evidence-audit.test.ts` / P1-11-R3 ✅ `test/scripts/measure-budget.test.ts`·`engine.test.ts` / verify ✅
- 바꾼 파일: `src/core/rules/audit.ts`(신규), `src/core/rules/evidence.ts`(`value()`), `src/core/job/{record,engine,decide,runner}.ts`, `src/core/report/{report,markdown}.ts`, `src/server/{view,jobs}.ts`, `src/cli/floor.ts`, `src/web/model.js`, `scripts/measure-budget.ts`, `src/core/prompts/shared/common.md`
- 결정:
  - 범위(사용자가 "phase 9 진행"만 지시, 세션이 정함): P1-10 잔여(R1 모든 역할 근거 검사·화면/리포트 표시, R3, R5) + P1-11-R3(job.json CLI 버전). P1-11 본 측정은 실제 claude 반복 실행이라 사용자 몫으로 남김
  - `auditEvidence`는 **경고만** 남기고 판정은 바꾸지 않는다(P1-10-R2 강등은 기존 규칙 엔진 V-EVIDENCE-REF). 결과는 `job.json evidenceAudit`(제출마다 전체 재계산) → `JobView.evidenceAudit` → 리포트 JSON `evidenceAudit`(스키마 버전은 그대로, 필드 추가) → Markdown 주장 꼬리표 `⚠ 근거 확인 불가` + "## 근거 검사" 절, 화면 콘솔 주장 옆 꼬리표·토론/제안/PM 아래 `⚠ <이름>: <내용>` 줄
  - 종류 4개: `UNRESOLVED_REF` 근거 확인 불가, `VALUE_MISMATCH` 수치 불일치, `NO_BRIEF_REF` 브리핑 인용 없음, `UNSOURCED_NUMBER` 근거 없는 새 수치
  - R3 오탐 줄이기(데모 fixture로 확인): 참조별로 검사해 본문 숫자 중 하나라도 참조 값과 0.5%(또는 표기 자릿수 반올림) 안이면 통과. 불일치 후보는 다른 참조와도 안 맞는 숫자 중 참조 값 ±1% 안의 것. 어림수(`약 N`, `N대`, `N여`)는 느슨하게(5%) 일치만 보고 불일치·새 수치로 보지 않는다. ±1%보다 크게 틀린 값은 못 잡는다(한계)
  - R5: 한 자리 정수는 새 수치로 보지 않는다. 발언에 유효한 `snap:`·`derived:` 참조가 있으면 새 수치 검사를 건너뛴다. 수치 풀은 애널리스트·GUARD 브리핑 본문 숫자 + 그 브리핑들이 인용한 참조 값
  - `claudeCliVersion`: `RunOptions`/`FinalizeOptions`로 넘기고 `??=`로 처음 값만 기록. /floor는 finalize 때 기록(중간 실패 작업은 null). 실측 요약은 버전 혼재·미기록을 재측정 대상으로 표시하고 부록 표에 `CLI` 열 추가
  - 공통 프롬프트에 "제안서(ACE·BLITZ·PM)는 `brief:` 참조 대상이 아님" 추가 → 모든 역할 프롬프트 해시가 바뀜(본 측정 전이라 무방)
- 남은 일 (마무리 세션):
  1. `docs/ARCHITECTURE.md`에 `src/core/rules/audit.ts` 짧은 설명 (규칙 엔진 계층은 "(코드 참조)"라 어디에 둘지 판단 — 작업 엔진 절에 evidenceAudit 흐름 한 단락이 무난)
  2. 가이드(`docs/PIXEL-TRADING-FLOOR-가이드-v1.3.md`) 화면 설명에 `⚠ 근거 확인 불가`·`⚠ 수치 불일치` 표시 한두 줄 → 파일 rename v1.4 + 개정 이력 한 줄
  3. 진행표·"Phase 10 참고" 갱신(아래 미뤄진 항목 이전), 실측 기록 한 줄, "진행 중"을 `없음`으로 → PR → 검사 통과 시 병합
  - 미뤄진 항목(다음 Phase 후보): P1-11 본 측정(사용자 실행, `node scripts/measure-budget.ts run …` → `report`), 데모 fixture의 RISKY `brief:ACE#rationale`(데모 화면에 근거 확인 불가 1건 표시됨 — 둘지 고칠지 결정), 강제 방향 데모 fixture, 하단 시세 흐름 띠, CoinGecko 403, Windows 미검증 항목(P0-8-R6, P1-7-R4, `--open`)
- 실측: sonnet BTC algorithm 실전 스모크 1회(프롬프트 수정 전) 86초·호출 13·재시도 0·비용 $0.345·PM 기각(NO_TRADE)·CLI `2.1.285`. evidenceAudit 1건(RISKY `brief:ACE#c1` → 프롬프트 보완). 데모 fixture: algorithm 2건(RISKY 잘못된 참조, SAFE가 ACE 가격 84,186을 lastClose 83,500 참조와 함께 씀 — 둘 다 실제 문제), scalp 0건

## Phase 9 참고 (다음 세션)
- 제안 범위(P1 잔여):
  1. P1-11 본 측정: 조합별 10회 이상·시간대 분산·Windows에서 `node scripts/measure-budget.ts run <종목> <모드> --count N` → `report [--interface floor]`로 p99×1.5 산출, 명세 부록 기록(P1-11-R1·T1·T2). 표본 10건 미만이면 상한에 적용하지 않는다. job.json에 CLI 버전이 없어 버전 혼재를 못 잡으므로 본 측정 전 기록 추가 검토
  2. P1-10-R1 브리핑·토론 근거 참조 존재 검사 경고와 화면의 `근거 확인 불가` 표시, P1-10-R3 수치 불일치 경고
  3. 선택: 하단 시세 흐름 띠, 강제 방향 데모 fixture(지금은 `?demo=1`에서 강제 방향이 E-DEMO), CoinGecko 403 원인
  4. 미검증: Windows `taskkill` 트리 종료(P0-8-R6), `.cmd` 실행(P1-7-R4), Windows `--open`의 `rundll32`, 시작 스크립트 실기 확인
- Phase 8 결정 (유지):
  - `/floor`는 스킬(`context: fork`, `agent: floor-session`)이고, **스킬 frontmatter의 `hooks`는 포크된 문맥에 걸리지 않는다**(Claude Code 2.1.284 스모크). 그래서 도구 제한은 하위 에이전트 정의(`tools: Bash, Read, Write` + PreToolUse 훅 `scripts/floor-guard.ts`)가 한다. 훅 규칙은 ARCHITECTURE.md "리포트·데모·진단·CLI" 절
  - `$ARGUMENTS`는 인용부호 안에 넣지 말고 "이번 요청" 절에 원문으로 둔다(모델이 "인자 없음"으로 멈춘 적 있음)
  - 가이드는 Markdown(`docs/PIXEL-TRADING-FLOOR-가이드-v1.3.md`)으로 전환했고 PDF는 삭제(사용자 결정 2026-09-30). 개정은 명세와 같이 파일 rename + 개정 이력 한 줄. 화면 캡처는 없다
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
