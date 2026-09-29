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
- 실데이터 검증으로 명세에 반영된 규칙 (P0 v0.6, P1 v0.2): 주식 장중 TTL 25분, 외환 주말 규칙, 스캘핑 뉴스 수집(VIBE 제목만), NYSE Arca 허용, 달력 만료 30일 전 진단 경고

## 모델 호출 계층 (src/core/model, src/core/job)
- `createClaudeCliDriver` → `callRole`(예산 검사·재시도·호출 기록) → 역할 검증 함수. 드라이버: claude-cli(실전), fixture(데모, 호출 수 0), scripted(테스트)
- 테스트용 가짜 CLI: `test/fixtures/fake-claude.mjs` (표준 입력의 `#MODE=ok|env|auth|quota|garbage|long|hang`)
- 역할별 모델·사고 수준: `config/floor.config.json`의 `models` → `modelFor(role)`
- 실측(haiku, TARO 1회): 기본 68.7초·출력 7,638토큰, `--effort low` 54.4초·5,143토큰. **출력 길이(narrative)가 비용 대부분** → Phase 4에서 스키마 길이 축소
- 실측: 모델이 근거 참조를 `derived:macd/hist`, `snap:<snapshotId>#/sources/...`처럼 틀리게 씀 → Phase 4 프롬프트에 정확한 예시 필수 (`derived:macd.hist`, `snap:binance.perp.price#/last`)
