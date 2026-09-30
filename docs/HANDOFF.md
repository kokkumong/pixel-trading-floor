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
| **8** | **`/floor` 명령, 시작 스크립트, 가이드 v1.3, P1-11 실측** | 다음 |

## 진행 중 (세션 인계)

<!-- Phase 도중 세션을 나눌 때만 채운다. 형식은 next-phase 스킬 "중간 인계" 참고. PR 병합 전에 "Phase N+1 참고"로 옮기고 "없음"으로 되돌린다 -->
- Phase: 8, 이슈 #17, 브랜치 `feature/17-phase8-floor-command`
- 다음 단계: 구현 계속 (가이드 v1.3만 남음) → 같은 세션에서 마무리 가능
- 통과 기준: P1-5-R3·P0-F-T4 ✅ `test/scripts/floor-guard.test.ts` + 실제 스모크 / P1-5-R4 ✅ 같은 파일 / P0-F-R4 ✅ 같은 파일(값에 붙은 메타문자까지) / P0-7.6 ✅ `test/scripts/start-scripts.test.ts` / P1-11 도구 ✅ `test/scripts/measure-budget.test.ts` + 소표본 / 가이드 v1.3 ⬜
- 바꾼 파일: `.claude/skills/floor/SKILL.md`, `.claude/agents/floor-session.md`, `scripts/floor-guard.ts`, `scripts/measure-budget.ts`, `start-floor.cmd`, `start-floor-lan.cmd`, `.gitattributes`(`*.cmd` CRLF), 테스트 3개(`test/scripts/`)
- 결정:
  - `/floor`는 스킬(`context: fork`, `agent: floor-session`, `disable-model-invocation: true`)로 만든다. **스킬 frontmatter의 `hooks`는 포크된 문맥에 걸리지 않았다**(Claude Code 2.1.284 스모크: 세션이 `cd … && sed`, `python3 -c`, `| grep`을 그대로 실행). 그래서 도구 제한은 하위 에이전트 정의가 한다: `tools: Bash, Read, Write`(웹 도구는 목록에 없음) + 에이전트 frontmatter의 PreToolUse 훅(`scripts/floor-guard.ts`). 탐침으로 훅 차단 확인(`PreToolUse:Bash hook error: … 공통 코어 CLI만`)
  - 훅 규칙: Bash는 `node src/cli/floor.ts snapshot|next|submit|finalize`와 명령별 허용 옵션만(`--interface`는 floor만), 따옴표 밖 셸 메타문자 전부 거부(작은따옴표 안은 그대로 — Windows 경로), 큰따옴표 안 `$ \` ! 거부. Read는 `jobs/<id>/{inputs,prompts,schemas,outputs}/`, Write·Edit는 `outputs/`만(스냅샷 원본·job.json 접근 불가, P0-F-R3). 그 밖의 도구 전부 거부
  - `$ARGUMENTS`를 인용부호 안에 넣었더니 모델이 "인자가 없다"고 멈췄다 → "이번 요청" 절에 원문을 따로 두고 예시를 붙임
  - 시작 스크립트: `chcp 65001` → `cd /d "%~dp0"` → `where node` 확인 → `node src\server\main.ts --open`(LAN은 `--lan --open` + 신뢰 Wi-Fi·읽기 전용·2시간·개인 네트워크 방화벽 안내) → `pause`. 리다이렉트·로그 파일 없음
  - P1-11: 사용자 결정(2026-09-30)으로 도구 + 소표본만. 본 측정(조합별 10회 이상, 시간대 분산, Windows)과 명세 부록 기록(P1-11-R1·T1·T2)은 남은 일. 산출은 `node scripts/measure-budget.ts report [--interface floor]`, 실행은 `run <종목> <모드> --count N`
  - 가이드 v1.3: 사용자 결정(2026-09-30)으로 **Markdown으로 전환하고 PDF는 삭제**(이미지는 빼거나 설명으로 대체)
- 남은 일 (순서대로):
  1. 가이드 v1.3 작성: `pdftotext -layout docs/PIXEL-TRADING-FLOOR-가이드-v1.2.pdf -`를 쪽 단위로 읽어 `docs/PIXEL-TRADING-FLOOR-가이드-v1.3.md`로 옮기고, P0 명세 12장 표 전 항목 + "Phase 8 참고"의 화면 변경 + `/floor` 사용법(스킬, 단일 세션 분석, 도구 제한, `lightweight` 아님)을 반영. 개정 이력 절에 v1.3 한 줄. `git rm` v1.2 PDF
  2. CLAUDE.md의 가이드 줄(`가이드-v1.2.pdf`)과 "PDF" 토큰 절약 규칙을 Markdown 가이드에 맞게 고친다. ARCHITECTURE.md "리포트·데모·진단·CLI" 절에 `/floor` 스킬·에이전트·훅과 `measure-budget.ts` 한두 줄
  3. 마무리(인계 갱신 → PR → 병합). 진행표 8 ✅, 다음 Phase는 진행표에 없으므로 "P1 잔여(P1-11 본 측정, P1-10-R1·R3 근거 경고 등)"를 새 행으로 제안
- 실측:
  - `/floor BTC scalp` (sonnet, `claude -p`, 2회째): 78초, 보고 비용 $0.39, 도구 Bash 12(전부 코어 명령)·Read 15·Write 5, 웹 도구 0건, 훅 거부 0건, 결과 ACE 관망(NO_EDGE). 1회째(훅 미적용 상태) 101초 $0.50
  - 브라우저 경로 소표본(sonnet, BTC, 2026-09-30): algorithm 2건 86~90초 호출 13·재시도 0, scalp 5건 36~43초. 호출 하나 4~16초로 임시 호출 제한(90·120초)보다 훨씬 짧다. 산출(표본 부족, 미확정): algorithm maxDuration 111초·callTimeout 최대 19초, scalp 66초·24초. 표본이 작으면 p99×1.5가 너무 빡빡하므로 10건 이상 전에는 적용하지 않는다
  - Claude Code가 세션 중 2.1.284 → 2.1.285로 자동 갱신됨. job.json에는 CLI 버전이 없어 `measure-budget`이 CLI 버전 혼재를 못 잡는다(리포트 메타에는 있음) — 본 측정 전 보완 후보

## Phase 8 참고 (다음 세션)
- 범위: `/floor` 명령 정의(P1-5, P0-F-R1~R6·T4 도구 제한), 시작 스크립트 `start-floor.cmd`·`start-floor-lan.cmd`(P0-7.6, **서버 출력을 파일로 남기지 않는다** — LAN 토큰이 서버 창에 찍힘), 가이드 v1.3(P0 명세 12장 목록 + 아래 화면 변경), P1-11 예산 상한 실측 보정
- `/floor`가 쓸 것: CLI `node src/cli/floor.ts snapshot|next|submit|finalize`(Phase 5, 단계 엔진 `next/submit/finalize`). 결과 패널의 `단일 세션 분석` 배지(P0-F-R6)는 `panelModel`이 `executionBackend === 'single_session'`으로 붙인다(Phase 7). 리포트 쪽 `analystIndependence: shared_context` 기록은 확인할 것
- 가이드 v1.3에 반영할 접속 변경(이슈 #11): 2-4절 주소 표의 `localhost:8000` 직접 입력 → 서버 창·시작 스크립트가 여는 `?t=` 주소 (P0 명세 v0.9 12장). 화면 변경(Phase 7): 전광판은 모든 종목에서 보이고(한국 종목만 멀티 거래소 표 추가), 강제 방향은 탭마다 처음 한 번 확인 창, 확신도는 LOW/MEDIUM/HIGH(`58%` 같은 표기 삭제), 스캘핑·강제 방향 화면에는 PM 자리 없음, 상단 "데이터가 오가는 곳" 버튼(6.2 문안), 데모 전광판은 녹화 시세(P1-8-R5), 하단 시세 흐름 띠(가이드 1쪽의 BTC·ETH·TSLA… 띠)는 구현하지 않음
- 이번 결정: 전광판은 종목별 15초 서버 캐시 + 화면 15초 갱신(IP당 분당 120회 한도 안). 등락은 직전 완성 봉 종가 기준(주식 장 마감 뒤 1시간 안의 시세는 전 거래일 종가 기준). 강제 방향 확인은 ANALYZE를 누를 때(모드 버튼이 아니라). 데모 전광판은 `BTC`만(다른 종목은 `E-DEMO`). 확신도는 패널·콘솔 모두 3단계만, 숫자 원값은 리포트에만. 웹 JS는 `tsconfig.web.json`(checkJs, DOM lib)으로 검사하고, 테스트가 `model.js`를 import하도록 서버 tsconfig에 `allowJs`
- 이슈 #11(보안 보강) 완료: 로컬 토큰(P0-7-R12)·부작용 GET 제거·Node 보안 패치 경고·실제 claude 도구 차단(P1-7-T6)·뉴스 인젝션 표본(P1-7-T3, 1쌍). **시작 스크립트는 `node src/server/main.ts --open`으로 띄운다**: 서버가 로컬 토큰 주소로 브라우저를 연다(주소를 파일로 남기지 않음). LAN용도 `--lan --open`. 수동 보안 스모크: `node scripts/security-smoke.ts tools|inject|inject-only`
- 남은 일: 하단 시세 흐름 띠(선택), 강제 방향 데모 fixture(지금은 `?demo=1`에서 강제 방향을 누르면 E-DEMO), 브리핑·토론 근거 참조 존재 검사 경고와 화면의 `근거 확인 불가` 표시(P1-10-R1), P1-10-R3 수치 불일치 경고, CoinGecko 403 원인, 미검증 항목(Windows `taskkill` 트리 종료 P0-8-R6·`.cmd` 실행 P1-7-R4, Windows에서 `--open`의 `rundll32` 동작). LAN HTTPS는 도입하지 않기로 결정(사용자, 2026-09-29): 평문 HTTP 유지, LAN은 읽기 전용·2시간 토큰·신뢰 네트워크 경고(P0 명세 7.2의 수용된 한계)
- 알려진 한계: 서버 시작 순간 별도 프로세스의 `floor.ts analyze`가 돌고 있으면 그 작업도 INTERRUPTED. macOS 기본 `unzip`은 UTF-8 파일명을 `?`로 보임. 픽셀 폰트는 PC에 `DungGeunMo`·`Galmuri11`이 있으면 쓰고 없으면 고정폭 글꼴(외부 폰트 불가)
- 실측(sonnet, 픽셀 화면 BTC scalp 1회, Phase 7 스모크): 36.2초, 호출 5회, 재시도 0, 출력 5,753토큰, 보고 비용 $0.116, 결과 ACE 관망(거래 없음 · 강세 전망), 확신도 LOW. 화면: 역할별 생각 중 표시 → 말풍선 → 콘솔 타이핑 → 판정 패널 → 리포트 저장 알림 확인
- 확인용: `npm start` → http://localhost:8000/?demo=1 (algorithm·scalp 데모), 실전 전광판은 `하이닉스` 입력, `node --test "test/web/*.test.ts" "test/server/*.test.ts"`. 브라우저 미리보기는 `.claude/launch.json`의 `floor`

## 실측 기록

- 실측(haiku, TARO 1회, Phase 3): 기본 68.7초·출력 7,638토큰, `--effort low` 54.4초·5,143토큰 → Phase 4에서 스키마 길이 축소 (narrative 1000자, claims 최대 6개)
- 실측(sonnet, BTC scalp 5회, Phase 4 스모크): 43초, 출력 합계 6,401토큰, 보고 비용 $0.18, 재시도 0, 근거 참조 오류 0
- 실측(sonnet, BTC algorithm 13회, Phase 5 스모크 = M1): 86초, 출력 합계 약 14,300토큰, 보고 비용 $0.458, 재시도 0, 토론 2라운드, PM 기각
- 개발 세션 토큰(Opus, Phase 2~7 세션 5개, 2026-09-29 분석): 세션당 모델 호출 84~190회, 호출당 평균 문맥 21만~32만(최대 51만), 문맥 재읽기 1,710만~5,960만 토큰, 출력 12만~26만 토큰. 원인은 긴 세션·통째 읽기·스크린샷·verify 전체 출력(약 74KB) → CLAUDE.md "토큰 절약" 규칙과 세션 분할 도입 (이슈 #15)
