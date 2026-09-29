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
없음

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
