# PIXEL TRADING FLOOR

AI 에이전트 13명(역할)이 시장 데이터를 분석·토론·심사해 판정을 내리는 **분석 시뮬레이션**. 실제 주문·자금 이동 기능은 없고 넣지 않는다.

## 문서 (진실의 원천)
- `docs/PIXEL-TRADING-FLOOR-P0-명세-v0.2.md` — 지켜야 할 계약과 검증 항목. 요구사항 `P0-<n>-R<m>`, 검증 `P0-<n>-T<m>`
- `docs/PIXEL-TRADING-FLOOR-구조-보완안-v1.1.md` — 목표 구조와 P1/P2
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

## claude -p 호출 규약 (스파이크 결과, Claude Code 2.1.280 / macOS)
```
claude -p --safe-mode --tools "" --no-session-persistence --output-format json \
  --model <m> --system-prompt <역할 프롬프트> --json-schema <스키마 JSON> <입력>
```
- `--safe-mode`: CLAUDE.md·스킬·플러그인·훅·MCP를 끈다. 구독(OAuth) 인증은 그대로 동작한다. `--bare`는 API 키 인증만 되므로 쓰지 않는다
- `--system-prompt`로 기본 프롬프트를 교체하면 입력 오버헤드가 거의 없다 (haiku 실측 입력 1,383토큰, 7초)
- 응답 JSON: `type:"result"`, `subtype:"success"`, `is_error`, `result`(문자열), **`structured_output`(스키마 강제 객체)**, `usage.input_tokens/output_tokens`, `total_cost_usd`, `duration_ms`, `api_error_status`
- 실행 파일은 셸 alias가 아니라 실제 경로로 찾는다 (`claude`가 alias일 수 있음). spawn은 셸 없이 인자 배열로
- env는 허용 목록으로 구성하고 `ANTHROPIC_API_KEY`는 기본 제외 (구독 대신 API 과금 방지)
- 취소: macOS/Linux는 `spawn({detached:true})` + `process.kill(-pid)`로 약 1초 안에 그룹 전체가 종료됨 (확인함). Windows는 `taskkill /pid <pid> /T /F` (Windows에서 미검증)
- **인증 실패(설정 없음 + 잘못된 키)일 때 오류를 내지 않고 무기한 대기했다.** 호출 시간 제한은 필수이고, 분석 전에 `diag`로 로그인 상태를 확인한다
