# PIXEL TRADING FLOOR P0 명세 v0.8

- 작성일: 2026-09-29
- 문서 버전: v0.8 (초안)
- 최근 개정: 2026-09-29
- 상위 문서: `PIXEL-TRADING-FLOOR-구조-보완안-v1.2.md` 5장 P0
- 후속 문서: `PIXEL-TRADING-FLOOR-P1-명세-v0.3.md`
- 참조 문서: `PIXEL-TRADING-FLOOR-가이드-v1.2.pdf`
- 문서 성격: 실행 가능성 검증 전에 확정할 설계 명세. 구현 방법이 아니라 **지켜야 할 계약과 판정 기준**을 정의한다.
- 제외 범위: 실제 소스 코드 확인. 코드와 대조해야 하는 부분은 `[코드 확인 필요]`로 표시한다.

> 표기 규칙: **반드시(MUST)** 는 위반하면 P0 불통과, **권장(SHOULD)** 은 예외 사유를 기록하면 허용, **선택(MAY)** 은 구현 재량이다. 요구사항 ID는 `P0-<항목번호>-R<번호>`, 검증 항목 ID는 `P0-<항목번호>-T<번호>` 형식을 쓴다. `/floor` 경로는 P0 항목 전체에 걸치므로 `P0-F-R<번호>`를 쓴다.

## 개정 이력

| 버전 | 날짜 | 변경 내용 |
|---|---|---|
| v0.1 | 2026-09-29 | 보완안 v1.1의 P0 8개 항목에 대한 최초 명세 |
| v0.2 | 2026-09-29 | 확인 필요 사항 비판적 검토 반영: 토론 조기 종료(11~13회), 판정에 `bias`·`unforcedDecision` 추가, 확신도 숫자 경계 폐지와 3단계 표시, 상한값 산식화 및 임시값 조정, 에이전트 입력 축소, LAN 토큰 만료 단축과 평문 HTTP 한계 명시, `/floor` 공통 코어 사용 의무화(9장 신설) |
| v0.3 | 2026-09-29 | 보완안 v1.2 우선순위 개정 반영: 9장을 P0 과도기 분류(P0-F-R7~R9)와 P1 구현 계약(P0-F-R1~R6)으로 분리, 추정 시세 조건부 사용 경로 폐기, 과거 판정 회고 비활성화와의 관계 명시, 상한 실측과 리포트 버전 추적을 P1 명세로 연결, `FinalDecision.status`에 `UNSUPPORTED_SYMBOL`·`INTERRUPTED` 추가 (P0-4-R5 및 P1 상태 머신과 정합) |
| v0.4 | 2026-09-29 | 3.6절 검증 규칙에 `V-ACTION` 추가 (2.2절 모드별 허용 행동을 스키마 검증으로 강제), 검증 항목 P0-3-T7 추가 |
| v0.5 | 2026-09-29 | `V-INSTRUMENT`에 `marketType` 일치 검사 추가 (3.2절 시장 임의 전환 금지를 코드로 강제). `forced_direction` 예외를 강등 대상 규칙 위반 전체로 확대 (`NO_TRADE`를 허용하지 않는 모드에서 강등하면 허용 행동과 모순됨). 검증 항목 P0-3-T8, T9 추가 |
| v0.6 | 2026-09-29 | 실데이터 수집 검증(2026-09-29) 반영: 주식 장중 TTL 20분 → 25분 (무료 공급자 지연이 20분이라 항상 만료됨), 환율에 외환시장 주말 규칙 추가 (주말마다 한국 종목 알고리즘 분석이 막힘), `scalp`·`forced_direction`에서도 뉴스 헤드라인을 선택 소스로 수집 (4.3절과 4.6절 VIBE 입력의 불일치 해소), 15분봉·일봉 TTL 문구 명확화 (동작 변경 없음) |
| v0.7 | 2026-09-29 | 7.4절 `[코드 확인 필요]` 해소: HTTP 서버(Phase 6)의 실제 라우트 전체를 접근 표에 추가. LAN 세션 쿠키 만료는 토큰 만료 시각을 따르고, 분석 실행 요청 제한은 인증·출처 검사를 통과한 요청만 센다고 명시. 보안 재검토 반영: LAN은 사설 IPv4 인터페이스로만 접속을 받음(7.1), 로컬 전용 모드의 한계(7.2), 교차 사이트 요청 차단 P0-7-R10과 자원 상한 P0-7-R11 추가, 검증 항목 P0-7-T7·T8 추가 |
| v0.8 | 2026-09-29 | 픽셀 UI(Phase 7) 반영: 7.4절 라우트 표에 전광판 시세 `GET /api/board`(read, 종목별 15초 캐시, 데모는 fixture만) 추가, `/api/status`에 모드별 계획·최악 호출 수(P0-1-R6). 6.4절 R2 `[코드 확인 필요]` 해소: 데모 전광판은 녹화 fixture로 그리고 외부 요청을 보내지 않는다(데모 경로에 네트워크 클라이언트 없음). 11.3절 공격 모드 URL 실행 여부 확인: URL로 모드를 고르지 않는다 |

## 0. P0 항목과 이 문서의 대응

| P0 | 항목 | 보완안 근거 | 이 문서 |
|---|---|---|---|
| 1 | 호출·토론 단위 정의 | 3.1 | 1장 |
| 2 | 모드별 최종 의사결정자 | 3.2, 11.3 | 2장 |
| 3 | 공통 판정 스키마 | 3.6, 3.14 | 3장 |
| 4 | 데이터 스냅샷과 데이터 품질 정책 | 3.3, 3.4, 3.5, 3.10 | 4장 |
| 5 | 공격 모드의 명시적 격리 | 3.8 | 5장 |
| 6 | 외부 데이터 전송 문구 정정 | 3.16 | 6장 |
| 7 | 로컬 전용 모드와 LAN 공유 모드의 보안 경계 | 9.1, 9.2 | 7장 |
| 8 | 분석 한 건당 호출·토큰·시간·재시도 상한 | 10.1, 10.2 | 8장 |
| 9 | `/floor` 결과의 과도기 분류 (구조 전환 계약 포함) | 3.11, 11.1 | 9장 |

이 문서에서 **확정한 결정**과 그 근거는 11장에 모아 두었다.

---

## 1. 호출·토론 단위 정의 (P0-1)

### 1.1 가이드 수치 역산

가이드 v1.2의 알고리즘 모드 호출 수 13회는 다음 합과 일치한다.

```text
애널리스트 4 + 토론 4 + ACE 1 + 리스크 3 + PM 1 = 13
```

따라서 가이드의 `토론 4턴`은 **BULL/BEAR 교대 발언 4회**(보완안 3.1의 절약안)로 해석된다.

스캘핑·공격 모드의 5회는 `TARO 1 + VIBE 1 + BLITZ 1 + GUARD 1 + ACE 1 = 5`와 일치한다.

`[코드 확인 필요]` 실제 코드의 토론 루프가 4발언인지 4왕복인지, 재시도 호출이 존재하는지 확인한다.

### 1.2 토론 규모에 대한 판단

토론을 4라운드(8발언, 알고리즘 17회 호출)로 늘리지 않는다. 이유는 다음과 같다.

- BULL과 BEAR는 같은 모델이 같은 데이터로 입장만 바꿔 말하는 구조라, 라운드가 늘수록 새 근거 없이 주장을 되풀이하거나 한쪽으로 쏠리기 쉽다.
- 토론 단계가 판정 품질에 기여하는지 자체가 아직 검증되지 않았다 (보완안 11.4 제거 실험 미실시). 효과를 모르는 단계를 키우지 않는다.

대신 2라운드를 **상한**으로 두고, 1라운드 뒤 쟁점이 남지 않으면 조기 종료한다. 라운드 상한은 P2 제거 실험 결과로 다시 정한다.

### 1.3 용어 정의

| 필드 | 타입 | 정의 |
|---|---|---|
| `agentCount` | 정수 | 제품에 정의된 역할 수. 현재 13 (TARO, DIANA, NOVA, VIBE, BULL, BEAR, BLITZ, GUARD, RISKY, SAFE, NEUTRAL, ACE, PM) |
| `activeAgentCount` | 정수 | 이번 작업에서 한 번 이상 발언한 역할 수 |
| `plannedModelCallRange` | `{min, max}` | 재시도 없이 정상 완료될 때의 호출 수 범위. 작업 시작 전에 확정된다 |
| `modelCallCount` | 정수 | 실제로 **시작된** 모델 호출 수. 재시도, 시간 초과, 취소로 중단된 호출을 모두 포함한다 |
| `retryCallCount` | 정수 | `modelCallCount` 중 재시도 호출 수 |
| `maxDebateRounds` | 정수 | 토론 라운드 상한 |
| `debateRoundCount` | 정수 | 실제 진행한 라운드 수. BULL 1발언 + BEAR 1발언 = 1라운드 |
| `debateMessageCount` | 정수 | 토론 발언 수 (BULL과 BEAR 합계) |
| `debateStopReason` | 열거형 | `MAX_ROUNDS` \| `NO_OPEN_ISSUES` \| `NO_NEW_EVIDENCE` \| `BUDGET` |
| `roleTurnCount` | 정수 | 역할별 발언 수의 합. `/floor`처럼 한 세션이 여러 역할을 수행할 때 호출 수 대신 쓴다 |
| `executionBackend` | 열거형 | `subprocess_per_role` (브라우저 경로) 또는 `single_session` (`/floor`) |

### 1.4 토론 발언 출력과 조기 종료 규칙

토론 발언은 자연어 본문과 함께 다음 정형 필드를 출력한다.

```yaml
speaker: BULL | BEAR
round: 정수
steelman: 문자열            # 상대의 가장 강한 근거 요약 (보완안 11.2). 첫 BULL 발언은 null
evidenceRefs: 문자열 배열    # 스냅샷 필드 경로 또는 애널리스트 브리핑 ID
openIssues: 문자열 배열      # 상대가 아직 답하지 않은 핵심 쟁점, 최대 3개
```

1라운드가 끝나면 코드가 다음 순서로 판단한다.

1. 1라운드 BEAR 발언의 `openIssues`가 비어 있으면 `NO_OPEN_ISSUES`로 종료한다.
2. 1라운드 BEAR 발언의 `evidenceRefs` 중 1라운드 BULL 발언이 인용하지 않은 항목이 하나도 없으면 `NO_NEW_EVIDENCE`로 종료한다.
3. 그 외에는 2라운드를 진행하고 `MAX_ROUNDS`로 종료한다.

이 규칙은 초기 규칙이다. P2에서 조기 종료한 작업과 2라운드를 모두 진행한 작업의 판정 품질을 비교해 유지 여부를 정한다.

### 1.5 요구사항

- **P0-1-R1 (반드시)** 토론 단위는 `1라운드 = BULL 1발언 + BEAR 1발언`으로 고정한다. 알고리즘 모드는 `maxDebateRounds = 2`이며 BULL이 먼저 발언한다. 1.4절 규칙에 따라 1라운드에서 종료할 수 있다.
- **P0-1-R2 (반드시)** UI, 가이드, 리포트에서 `토론 4턴` 표기를 `토론 최대 2라운드`로 바꾸고, 실행 후에는 실제 라운드 수와 종료 사유를 표시한다.
- **P0-1-R3 (반드시)** 모드별 계획 호출 수는 다음 산식 한 줄로 재현할 수 있어야 한다.

| 모드 | 산식 | `plannedModelCallRange` | `activeAgentCount` |
|---|---|---|---|
| `algorithm` | 애널리스트 4 + 2 × `debateRoundCount` + ACE 1 + 리스크 3 + PM 1 | 11~13 | 11 (BLITZ·GUARD 제외) |
| `scalp` | TARO 1 + VIBE 1 + BLITZ 1 + GUARD 1 + ACE 1 | 5 | 5 |
| `forced_direction` | `scalp`와 같음 | 5 | 5 |

- **P0-1-R4 (반드시)** `modelCallCount`에는 재시도 호출과 취소·시간 초과로 끝난 호출도 포함한다. 데모 모드의 가짜 응답 재생은 `modelCallCount = 0`으로 기록한다.
- **P0-1-R5 (반드시)** `executionBackend = single_session`인 `/floor` 실행은 `roleTurnCount`를 기록한다. `/floor` 결과와 브라우저 결과의 호출 수를 같은 표에서 비교하지 않는다. `/floor`의 나머지 요구사항은 9장을 따른다.
- **P0-1-R6 (반드시)** 실행 전 화면에는 계획 호출 수 범위와 최악 호출 수(8장의 `maxModelCalls`)를 함께 표시한다.

```text
예상 모델 호출: 11~13회 (재시도 시 최대 17회)
토론: 최대 2라운드
```

- **P0-1-R7 (반드시)** 실행 후 리포트와 UI에 `modelCallCount`, `retryCallCount`, `debateRoundCount`, `debateStopReason`을 표시한다.

### 1.6 검증 항목

- **P0-1-T1** 정상 완료된 알고리즘 작업의 로그상 호출 수가 `11 + 2 × (debateRoundCount − 1)`이고 UI 표시와 일치한다.
- **P0-1-T2** 1라운드 BEAR 발언의 `openIssues`를 비운 응답을 주입하면 2라운드 호출 없이 `NO_OPEN_ISSUES`로 종료된다.
- **P0-1-T3** 토론 중 한 번 재시도가 발생하면 `retryCallCount = 1`이고 `modelCallCount`가 1 증가한다.
- **P0-1-T4** ACE 호출 중 취소하면 이미 시작된 ACE 호출까지 `modelCallCount`에 포함되고, 이후 호출은 시작되지 않는다.
- **P0-1-T5** 데모 모드 리포트에 `modelCallCount = 0`이 기록된다.

---

## 2. 모드별 최종 의사결정자 (P0-2)

### 2.1 결정

보완안 3.2의 권장안 2번(모드별 최종 책임자 분리)을 채택한다. 다만 어떤 모드든 최종 판정 뒤에는 **결정론적 위험 규칙 엔진**(3.6절)이 실행되고, 규칙 엔진은 판정을 `NO_TRADE`로 강등할 수 있다. 규칙 엔진은 모델이 아니라 코드이므로 "의사결정자"가 아니라 "차단 장치"로 표기한다.

### 2.2 모드별 책임 구조

| 항목 | `algorithm` | `scalp` | `forced_direction` |
|---|---|---|---|
| 화면 이름 | 알고리즘 | 스캘핑 20x | 강제 방향 시뮬레이션 |
| 제안 작성자 | ACE | ACE | ACE |
| 리스크 검토자 | RISKY, SAFE, NEUTRAL | GUARD | GUARD |
| 리스크 검토 시점 | `post_proposal` (ACE 뒤) | `pre_proposal` (ACE 앞) | `pre_proposal` |
| 최종 의사결정자 | PM | ACE | ACE |
| 규칙 엔진 차단 | 적용 | 적용 | 적용 (단, 3.6절 예외) |
| 허용 행동 | `ENTER_LONG`, `ENTER_SHORT`, `NO_TRADE` | 같음 | `ENTER_LONG`, `ENTER_SHORT` |
| 결과 등급 `resultClass` | `analysis` | `analysis` | `simulation` |

### 2.3 결과 메타데이터

모든 최종 결과에 다음 필드가 있어야 한다.

```yaml
mode: algorithm | scalp | forced_direction
resultClass: analysis | simulation
finalDecisionMaker: PM | ACE
riskReview:
  reviewed: true | false
  reviewers: [RISKY, SAFE, NEUTRAL] | [GUARD]
  timing: post_proposal | pre_proposal
pmDecision: APPROVE | MODIFY | REJECT | null   # algorithm 외에는 null
ruleEngine:
  verdict: PASS | DOWNGRADED | BLOCKED
  violations: 규칙 코드 배열
forcedDirection: true | false
```

### 2.4 요구사항

- **P0-2-R1 (반드시)** `finalDecisionMaker ≠ PM`인 결과의 화면, 리포트, 알림 어디에도 `PM 승인`, `최종 승인`이라는 문구를 쓰지 않는다.
- **P0-2-R2 (반드시)** 판정 패널 제목은 다음 표를 따른다.

| 조건 | 판정 패널 표기 |
|---|---|
| `algorithm` + `pmDecision = APPROVE` | `PM 승인` |
| `algorithm` + `pmDecision = MODIFY` | `PM 수정승인` + 변경 필드 목록 |
| `algorithm` + `pmDecision = REJECT` | `PM 기각 → 거래 없음` |
| `scalp` | `ACE 판정 · GUARD 사전 검토` |
| `forced_direction` | `강제 방향 시뮬레이션 · 판정 아님` |
| `ruleEngine.verdict ≠ PASS` | 위 표기 앞에 `규칙 차단` 배지 추가 |

- **P0-2-R3 (반드시)** PM 출력은 보완안 11.3의 정형 필드(`pmDecision`, `modifiedFields`, `reasonCodes`)를 포함한다. `MODIFY`인데 `modifiedFields`가 비어 있으면 스키마 오류로 처리한다.
- **P0-2-R4 (반드시)** `pmDecision = REJECT`이면 최종 행동은 `NO_TRADE`다. ACE의 원래 제안은 리포트의 `proposals` 영역에만 남긴다.
- **P0-2-R5 (반드시)** 가이드 표지 문구 `리스크 위원회의 심사와 포트폴리오 매니저의 승인을 거쳐`에 `(알고리즘 모드 기준)`을 덧붙인다.

### 2.5 검증 항목

- **P0-2-T1** 스캘핑 결과 화면과 리포트에서 `PM` 문자열이 검색되지 않는다 (역할 소개 영역 제외).
- **P0-2-T2** PM이 `MODIFY`로 손절가를 바꾸면 최종 판정의 손절가가 PM 값이고, `modifiedFields`에 `stopLoss`가 있다.
- **P0-2-T3** PM이 `REJECT`하면 최종 행동이 `NO_TRADE`로 표시된다.

---

## 3. 공통 판정 스키마 (P0-3)

### 3.1 설계 원칙

1. 모델이 생성하는 **제안서**(`TradeProposal`)와 시스템이 확정하는 **최종 판정**(`FinalDecision`)을 다른 객체로 둔다.
2. 모델 출력은 JSON으로 받고, 코드가 파싱·검증한다. 자연어 브리핑은 표시용이며 판정 로직의 입력이 아니다.
3. **행동**(`action`: 무엇을 할지)과 **방향 판단**(`bias`: 시장을 어떻게 보는지)을 분리한다. 거래하지 않는 판정에서도 방향 판단 정보가 사라지지 않게 하기 위해서다.
4. 화면 문구(BUY, 롱 등)는 최종 판정에서 파생되는 표시값일 뿐 저장값이 아니다.

### 3.2 행동과 방향 판단

앱은 사용자의 보유 포지션을 입력받지 않는다 (11장 D3). 포지션을 알면 결과가 개인 맞춤 조언에 가까워지고 개인 금융 정보를 다루게 되기 때문이다. 따라서 포지션에 의존하는 행동(보유 유지, 보유분 청산)은 두지 않는다.

**행동 `action`**

| 값 | 의미 |
|---|---|
| `ENTER_LONG` | 신규 매수 또는 롱 진입 제안 |
| `ENTER_SHORT` | 신규 숏 진입 제안. `marketType = perpetual`에서만 허용 |
| `NO_TRADE` | 거래하지 않음. 관망, 근거 부족, 규칙 차단을 모두 포함하며 사유는 `reasonCodes`로 구분 |

**방향 판단 `bias`**

| 값 | 의미 |
|---|---|
| `BULLISH` | 판정 유효 기간 안에 상승 쪽 근거가 우세 |
| `BEARISH` | 판정 유효 기간 안에 하락 쪽 근거가 우세 |
| `NEUTRAL` | 어느 쪽도 우세하지 않음 |

**화면 표기 조합**

| `action` | `bias` | 표기 |
|---|---|---|
| `ENTER_LONG` | `BULLISH` | `롱 진입` |
| `ENTER_SHORT` | `BEARISH` | `숏 진입` |
| `NO_TRADE` | `BULLISH` | `거래 없음 · 강세 전망` |
| `NO_TRADE` | `BEARISH` | `거래 없음 · 약세 전망` |
| `NO_TRADE` | `NEUTRAL` | `거래 없음 · 방향 불명확` |

**기존 표기의 변환 규칙**

| 기존 표기 | 조건 | 변환 |
|---|---|---|
| BUY, LONG | 모두 | `ENTER_LONG` + `BULLISH` |
| SHORT, SELL | `perpetual` | `ENTER_SHORT` + `BEARISH` |
| SELL | `spot` | `NO_TRADE` + `BEARISH` + `reasonCodes: [SPOT_SHORT_NOT_ALLOWED]` |
| HOLD, PASS | 모두 | `NO_TRADE` + 모델이 출력한 `bias` + `reasonCodes: [NO_EDGE]` |

약세 판단이 나왔다고 판정 기준 시장을 현물에서 무기한 선물로 자동 전환하지 않는다. 사용자가 요청하지 않은 시장으로 바꾸는 것이며 보완안 3.4의 임의 변환 금지 원칙에 어긋난다.

### 3.3 TradeProposal (ACE·BLITZ가 생성, PM이 수정 가능)

```yaml
schemaVersion: "proposal/2"
jobId: UUID
snapshotId: UUID
author: ACE | BLITZ | PM
action: ENTER_LONG | ENTER_SHORT | NO_TRADE
bias: BULLISH | BEARISH | NEUTRAL
unforcedAction: ENTER_LONG | ENTER_SHORT | NO_TRADE | null
                                # forced_direction에서 필수: 강제 규칙이 없었다면 고를 행동
                                # 다른 모드에서는 null
instrumentId: 문자열            # 스냅샷의 instrumentId와 같아야 함
marketType: spot | perpetual
priceBasis:                     # 가격이 어떤 시세 기준인지
  sourceRef: 문자열             # 스냅샷 sources[].id
  currency: KRW | USD | USDT
timeframe: 15m | 1h | 4h | 1d
expectedHoldingPeriod: 문자열   # 예: "4~24시간"
validForMinutes: 정수           # validUntil은 시스템이 계산
entry:
  type: market | limit | zone
  min: number | null
  max: number | null
stopLoss: number | null
targets: number 배열 (0~3개)
leverage: 정수 | null           # spot이면 null
confidence: 0~100 정수
rationale: 문자열 (최대 1,200자)
evidenceRefs: 문자열 배열        # 스냅샷 필드 경로 또는 에이전트 브리핑 ID
invalidationConditions: 문자열 배열
warnings: 문자열 배열
```

### 3.4 FinalDecision (시스템이 확정)

```yaml
schemaVersion: "decision/2"
jobId: UUID
snapshotId: UUID
mode: algorithm | scalp | forced_direction
resultClass: analysis | simulation | lightweight
status: VALID | NO_TRADE | INSUFFICIENT_DATA | UNSUPPORTED_SYMBOL | SCHEMA_ERROR | FAILED | CANCELLED | BUDGET_EXCEEDED | INTERRUPTED
action: ENTER_LONG | ENTER_SHORT | NO_TRADE | null     # status가 VALID/NO_TRADE일 때만 값 존재
bias: BULLISH | BEARISH | NEUTRAL | null
unforcedAction: ENTER_LONG | ENTER_SHORT | NO_TRADE | null
proposal: TradeProposal | null     # 최종 채택된 제안
decidedAt: ISO-8601
validUntil: ISO-8601               # decidedAt + validForMinutes, 모드 상한 적용
confidence:
  score: 0~100
  band: LOW | MEDIUM | HIGH        # 3.5절, 표시 전용
  calibrationVersion: "uncalibrated-v0"
reasonCodes: 문자열 배열
ruleEngine:
  verdict: PASS | DOWNGRADED | BLOCKED
  violations: 규칙 코드 배열
finalDecisionMaker: PM | ACE
forcedDirection: boolean
executionBackend: subprocess_per_role | single_session
```

`resultClass: lightweight`는 9장의 `/floor` 과도기 결과에만 쓴다.

### 3.5 확신도 표시

모델이 스스로 말하는 확신도는 확률이 아니며, 보정 전 값은 좁은 구간(대체로 50~75)에 몰리는 경향이 있다. 따라서 P2의 확신도 보정 전까지 다음을 지킨다.

- **P0-3-R6 (반드시)** 화면에는 숫자 게이지 대신 3단계 표시만 쓴다: `LOW` (0~49), `MEDIUM` (50~69), `HIGH` (70~100). 이 구간은 **표시용 묶음**일 뿐이며, 어떤 규칙·판정·강등 조건에도 쓰지 않는다.
- **P0-3-R7 (반드시)** 확신도 옆에 `보정 전 점수 · 적중 확률이 아님`을 표시한다. 숫자 원값은 리포트 본문에만 기록한다.
- **P0-3-R8 (반드시)** 확신도를 `%`로 표기하지 않는다.

### 3.6 검증 규칙 (결정론적 코드)

| 코드 | 규칙 | 위반 시 |
|---|---|---|
| `V-PARSE` | JSON 파싱 가능, 필수 필드 존재, 타입 일치 | 1회 재시도 후에도 실패하면 `SCHEMA_ERROR` |
| `V-INSTRUMENT` | `instrumentId`, `snapshotId`, `marketType`이 작업 값과 같음 | `SCHEMA_ERROR` |
| `V-POSITIVE` | 모든 가격 > 0, 유한수 | `SCHEMA_ERROR` |
| `V-CONF` | `confidence`가 0~100 정수 | `SCHEMA_ERROR` |
| `V-ENTRY` | `entry.type = market`이면 min·max null 허용, `limit`이면 min = max, `zone`이면 min < max | `SCHEMA_ERROR` |
| `V-UNFORCED` | `forced_direction`이면 `unforcedAction` 필수, 다른 모드면 null | `SCHEMA_ERROR` |
| `V-ACTION` | `action`이 모드별 허용 행동(2.2절)에 속함. `forced_direction`에서 `NO_TRADE` 금지 | `SCHEMA_ERROR` |
| `V-BIAS` | `forced_direction` 외 모드에서 `ENTER_LONG`이면 `BULLISH`, `ENTER_SHORT`이면 `BEARISH` | `DOWNGRADED` → `NO_TRADE` |
| `V-DIR-LONG` | `ENTER_LONG`: `stopLoss < entry.min ≤ entry.max < targets[i]` | `DOWNGRADED` → `NO_TRADE` |
| `V-DIR-SHORT` | `ENTER_SHORT`: `targets[i] < entry.min ≤ entry.max < stopLoss` | `DOWNGRADED` → `NO_TRADE` |
| `V-STOP-REQUIRED` | `ENTER_*`이면 `stopLoss` 필수 | `DOWNGRADED` |
| `V-SPOT-SHORT` | `spot`에서 `ENTER_SHORT` 금지 | `DOWNGRADED` (`bias`는 유지) |
| `V-PRICE-BASIS` | `priceBasis.sourceRef`가 `estimated: false`인 소스 | `DOWNGRADED` (4.5절) |
| `V-DATA-QUALITY` | 스냅샷 상태가 `INSUFFICIENT_DATA`가 아님 | `INSUFFICIENT_DATA` |
| `V-LEVERAGE-CAP` | `leverage ≤ 20`, spot이면 null | `DOWNGRADED` |
| `V-VALIDITY` | `validForMinutes`: scalp·forced ≤ 240, algorithm ≤ 10,080 | 상한으로 잘라내고 경고 |

`market` 진입의 방향 검증에는 스냅샷의 기준 가격(`priceBasis.sourceRef`)을 진입가로 쓴다. 강등(`DOWNGRADED`)되어도 `bias`는 모델 값을 유지한다.

`marketType`을 `V-INSTRUMENT`에 포함하는 이유: 3.2절은 약세 판단이 나와도 판정 기준 시장을 바꾸지 않는다고 정했다. 모델이 작업과 다른 시장(예: 현물 작업에 `perpetual`)으로 제안서를 쓰면 가격·레버리지 검증의 전제가 달라지므로 강등이 아니라 스키마 오류로 처리한다.

`forced_direction` 예외: 이 모드는 `NO_TRADE`를 허용하지 않으므로(2.2절, `V-ACTION`) 강등하면 허용 행동과 모순된다. 따라서 위 표에서 `DOWNGRADED`로 처리하는 규칙(`V-DIR-*`, `V-STOP-REQUIRED`, `V-PRICE-BASIS`, `V-LEVERAGE-CAP` 등, P1 명세 4.2절 `V-LIQ-BUFFER` 포함)의 위반은 모두 `NO_TRADE`로 강등하지 않고 `ruleEngine.verdict = BLOCKED`로 표시만 한다. 행동 값은 모델이 고른 방향을 그대로 두고, 결과 패널은 방향 대신 `규칙 위반 — 시뮬레이션 무효`를 보여준다. `V-BIAS`는 이 모드에 적용하지 않으며, `V-EVIDENCE-REF`의 근거 부족은 P1 명세 10.2절에 따라 경고만 한다. `V-DATA-QUALITY` 위반은 모든 모드에서 작업을 중단시킨다 (근거가 없는 데이터로는 강제 방향도 만들지 않는다).

### 3.7 요구사항

- **P0-3-R1 (반드시)** 모든 모드의 최종 결과는 `FinalDecision` 스키마 하나로 저장한다.
- **P0-3-R2 (반드시)** 3.6절 규칙은 모델 프롬프트가 아니라 코드로 적용한다. 프롬프트에 같은 규칙을 적는 것은 허용하지만 대체하지 않는다.
- **P0-3-R3 (반드시)** 스키마 오류 재시도는 호출당 1회로 제한하고 8장의 재시도 예산에서 차감한다.
- **P0-3-R4 (반드시)** 강제 방향 모드를 제외한 모든 모드에서 모델이 `NO_TRADE`를 선택할 수 있다는 사실을 프롬프트와 스키마에 명시한다.
- **P0-3-R5 (반드시)** `validUntil`이 지난 판정은 화면에서 `만료` 상태로 바뀐다.
- (R6~R8은 3.5절)

### 3.8 검증 항목

- **P0-3-T1** 롱 제안의 손절가가 진입가보다 높으면 `NO_TRADE` + `V-DIR-LONG`으로 표시되고, `bias`는 `BULLISH`로 남는다.
- **P0-3-T2** 한국 주식 현물(`KR:000660`, `spot`)에 `SELL`이 나오면 `거래 없음 · 약세 전망` + `SPOT_SHORT_NOT_ALLOWED`로 표시된다.
- **P0-3-T3** 잘린 JSON, 누락 필드, `NaN`, 음수 가격, 확신도 150을 각각 주입하면 모두 `SCHEMA_ERROR` 또는 재시도로 처리되고 정상 판정으로 표시되지 않는다.
- **P0-3-T4** 규칙 위반 결과가 UI에서 녹색(정상) 판정 색으로 표시되지 않는다.
- **P0-3-T5** 알고리즘 모드에서 `ENTER_LONG` + `BEARISH` 응답은 `V-BIAS`로 강등된다.
- **P0-3-T6** 화면 어디에도 확신도가 `%`나 숫자 게이지로 표시되지 않는다.
- **P0-3-T7** `forced_direction` 모드에서 `action: NO_TRADE` 응답은 `V-ACTION`으로 `SCHEMA_ERROR` 또는 재시도로 처리된다.
- **P0-3-T8** 현물 작업(`spot`)에 `marketType: perpetual`인 제안서는 `V-INSTRUMENT`로 `SCHEMA_ERROR` 또는 재시도로 처리된다.
- **P0-3-T9** `forced_direction`에서 `V-LEVERAGE-CAP` 위반(예: 레버리지 25)은 `BLOCKED`로 표시되고, 행동이 `NO_TRADE`로 바뀌지 않는다.

---

## 4. 데이터 스냅샷과 데이터 품질 정책 (P0-4)

### 4.1 원칙

- 분석 시작 시 데이터 수집을 한 번만 실행하고, 결과를 불변 `AnalysisSnapshot`으로 고정한다.
- 모든 에이전트는 스냅샷의 **필요한 부분만**(4.6절) 읽기 전용으로 받는다. 에이전트는 실행 중 외부 API를 조회하지 않는다.
- 숫자 계산(기술 지표, 괴리율, 변동성)은 모델이 아니라 코드가 한다. 모델에는 계산 결과와 최소한의 원자료만 넘긴다.
- 화면 전광판의 15초 갱신 시세와 분석 스냅샷은 다른 객체이며, 화면에서 구분 표시한다.

### 4.2 AnalysisSnapshot 스키마

보완안 3.3 최소 스키마에 소스 ID, 신선도 등급, 해시, 계산 지표를 추가한다.

```yaml
schemaVersion: "snapshot/2"
snapshotId: UUID
snapshotHash: sha256(정규화 JSON)
jobId: UUID
mode: algorithm | scalp | forced_direction
symbolInput: 사용자 원문
instrumentId: 문자열               # 예: KR:000660, CRYPTO:BTC, US:TSLA
marketType: spot | perpetual        # 판정 기준 시장
quoteCurrency: KRW | USD | USDT
requestedAt: ISO-8601
collectedAt: ISO-8601
sources:
  - id: 문자열                      # 예: "binance.perp.price"
    provider: 문자열
    endpointType: price | candle | news | sentiment | fx | funding | fundamentals
    required: boolean               # 이 모드에서 필수인지
    observedAt: ISO-8601 | null     # 공급자가 제공한 시각. 없으면 null
    fetchedAt: ISO-8601
    ageSeconds: 정수 | null
    ttlSeconds: 정수
    freshness: LIVE | NEAR_REALTIME | DELAYED | PERIODIC | ESTIMATED | UNKNOWN_TIME
    stale: boolean                  # ageSeconds > ttlSeconds
    estimated: boolean
    untrustedText: boolean          # 뉴스·RSS 등 외부 자유 텍스트 포함 여부
    status: ok | partial | failed
    payload: 공급자별 정규화 데이터
derived:                            # 코드가 계산한 값
  indicatorsVersion: 문자열
  indicators: 이동평균, RSI, MACD, ATR, 변동성, 최근 고저 등
  spreads: 선물↔현물 괴리 등 (환율 소스 ID 포함)
dataQuality:
  status: OK | PARTIAL_DATA | INSUFFICIENT_DATA
  requiredOk: 정수 / 정수
  optionalCompleteness: 0~1         # 정상 선택 소스 수 / 전체 선택 소스 수
  warnings: 문자열 배열
```

- **P0-4-R1 (반드시)** 스냅샷 생성 뒤 `snapshotHash`를 계산하고, 리포트 저장 시 같은 해시를 기록한다. 에이전트 호출 로그마다 `snapshotId`를 남긴다.
- **P0-4-R2 (반드시)** 공급자가 시각을 주지 않으면 `observedAt = null`, `freshness = UNKNOWN_TIME`으로 두고 UI에 `시각 미확인`을 표시한다. `fetchedAt`으로 대체하지 않는다.

### 4.3 모드별 필수·선택 데이터

가이드에 나온 데이터 공급원(Binance, Yahoo, CoinGecko, 뉴스 RSS, 공포탐욕지수, 환율, 거래소별 무기한 선물)을 기준으로 정의한다. 캔들 개수는 **지표 계산용** 최소 수량이며, 모델에 넘기는 수량은 4.6절을 따른다. `[코드 확인 필요]` 실제 공급자별 엔드포인트와 대조한다.

| 데이터 | `algorithm` | `scalp` / `forced_direction` |
|---|---|---|
| 판정 기준 시장의 최신 가격 | 필수 (현물) | 필수 (USDT 무기한) |
| 판정 기준 시장 캔들 | 필수 (일봉 ≥ 60개) | 필수 (15분봉 ≥ 96개) |
| 펀딩비 | 해당 없음 | 필수 |
| 환율 (KRW 표시 필요 시) | 필수 (한국 종목) | 선택 (표시용) |
| 기본 지표 (시총, 거래대금, 52주 고저) | 선택 | 해당 없음 |
| 뉴스 헤드라인 | 선택 | 선택 (VIBE에 제목만 전달) |
| 공포탐욕지수 | 선택 | 선택 |
| 거래소별 선물 가격·괴리 | 선택 (표시용) | 선택 |
| 탭비트 추정가 | 표시용 전용 | 표시용 전용 |

### 4.4 기본 TTL과 신선도 등급

초기값이며, 실행 검증(보완안 8장) 결과로 조정한다.

| 소스 유형 | 기본 등급 | TTL (`scalp`) | TTL (`algorithm`) |
|---|---|---|---|
| 코인·무기한 선물 가격 | LIVE / NEAR_REALTIME | 30초 | 120초 |
| 15분봉 | NEAR_REALTIME | 마지막 완성 봉 종료 후 한 봉 길이 + 90초 (다음 봉이 완성된 뒤 90초 안에 받아야 함) | 해당 없음 |
| 일봉 | PERIODIC | 해당 없음 | 가장 최근에 끝난 거래일의 봉이 없으면, 그 거래일 종료 후 36시간까지만 허용 |
| 주식 가격 (장중) | DELAYED | 해당 없음 | 25분 (무료 공급자 지연 20분 + 여유 5분) |
| 주식 가격 (장 마감) | PERIODIC | 해당 없음 | 다음 개장 전까지 |
| 펀딩비 | NEAR_REALTIME | 15분 | 해당 없음 |
| 환율 | NEAR_REALTIME | 1시간 (외환시장 주말 예외) | 1시간 (외환시장 주말 예외) |
| 뉴스 | PERIODIC | 헤드라인별 72시간 (넘으면 제외) | 헤드라인별 72시간 (넘으면 제외) |
| 공포탐욕지수 | PERIODIC | 36시간 | 36시간 |
| 기본 지표 | PERIODIC | 해당 없음 | 7일 |

외환시장 주말 예외: 금요일 22:00 UTC부터 일요일 22:00 UTC까지는 외환시장이 쉬므로, 금요일 20:00 UTC 이후에 관측된 환율을 유효로 본다. 이 예외가 없으면 한국 종목(환율 필수)의 알고리즘 분석이 주말마다 `INSUFFICIENT_DATA`로 끝난다.

주식 장중 TTL 근거: Yahoo Finance 등 무료 공급자의 KRX·미국 주식 시세는 약 20분 지연되어 도착한다 (2026-09-29 실측: 관측 시각 기준 1,201초). TTL은 공급자 지연보다 길어야 하므로 지연 20분에 폴링 여유 5분을 더한다. 실시간 공급자로 바꾸면 다시 정한다.

### 4.5 품질 판정 정책

| 조건 | `dataQuality.status` | 파이프라인 동작 |
|---|---|---|
| 필수 소스가 모두 `ok`이고 `stale = false` | `OK` 또는 `PARTIAL_DATA` | 진행 |
| 선택 소스 중 하나 이상 실패·만료 | `PARTIAL_DATA` | 진행. 해당 소스는 에이전트 입력에서 제외하고 경고 기록 |
| 필수 소스 중 하나라도 실패, 만료, `UNKNOWN_TIME` | `INSUFFICIENT_DATA` | 모델 호출 없이 종료. `FinalDecision.status = INSUFFICIENT_DATA` |
| 필수 가격이 `estimated: true`뿐 | `INSUFFICIENT_DATA` | 위와 같음 |

- **P0-4-R3 (반드시)** 추정 시세(`estimated: true`)는 필수 소스를 충족할 수 없고, `priceBasis`로 쓸 수 없다. 표시와 비교 용도로만 쓴다. (보완안 3.10 권장안을 P0 정책으로 채택. 조건부 사용 경로는 채택하지 않는다 — 보완안 v1.2)
- **P0-4-R4 (반드시)** `INSUFFICIENT_DATA`는 모델 호출 전에 판정해 호출 예산을 쓰지 않는다.
- **P0-4-R5 (반드시)** 지원하지 않는 심볼은 유사 심볼로 바꾸지 않고 `UNSUPPORTED_SYMBOL`로 종료한다.
- **P0-4-R6 (반드시)** 서로 다른 통화의 가격을 비교할 때는 스냅샷 안의 환율 소스를 참조하고, 환율 소스 ID를 함께 기록한다.

### 4.6 역할별 입력 범위

에이전트에게 스냅샷 전체를 넘기지 않는다. 역할별로 필요한 필드만 투영한다.

| 역할 | 입력 |
|---|---|
| TARO | 가격, `derived.indicators`, 최근 봉 (algorithm 일봉 30개, scalp 15분봉 32개) |
| DIANA | 가격, 기본 지표 |
| NOVA | 뉴스 헤드라인(제목·출처·시각·최대 300자 요약, 최대 10건) — `untrustedText` 표시 |
| VIBE | 공포탐욕지수, 뉴스 헤드라인 제목 |
| BULL / BEAR | 애널리스트 4명의 정형 브리핑, 이전 토론 발언 |
| BLITZ | 무기한 가격, `derived.indicators`, 최근 15분봉 32개, 펀딩비, TARO·VIBE 브리핑 |
| GUARD | BLITZ 계획, 변동성 지표, 펀딩비 |
| ACE | 위 결과 전체의 정형 요약, 기준 가격 소스 |
| RISKY / SAFE / NEUTRAL | ACE 제안, 변동성 지표, 앞선 심사 의견 |
| PM | ACE 제안, 리스크 심사 3건, 데이터 품질 경고 |

- **P0-4-R7 (반드시)** `untrustedText = true`인 데이터는 시스템 지침과 분리된 데이터 블록으로 전달하고, 그 안의 지시문을 따르지 않는다는 규칙을 모든 해당 역할의 시스템 지침에 둔다.
- **P0-4-R8 (반드시)** 기술 지표는 코드로 계산해 `derived`에 넣는다. 지표 계산용 전체 캔들은 스냅샷에만 두고 모델 입력으로 넘기지 않는다.

### 4.7 검증 항목

- **P0-4-T1** 한 작업의 모든 에이전트 로그의 `snapshotId`가 같다.
- **P0-4-T2** 스캘핑 모드에서 무기한 가격 소스를 실패시키면 모델 호출 0회로 `INSUFFICIENT_DATA`가 된다.
- **P0-4-T3** 뉴스 소스만 실패시키면 `PARTIAL_DATA`로 진행되고 리포트에 경고가 남는다.
- **P0-4-T4** 탭비트 추정가만 있고 직접 시세가 없으면 판정이 생성되지 않는다.
- **P0-4-T5** 리포트에 분석 기준 시각(`collectedAt`)과 소스별 `observedAt`이 표시되고, 현재 화면 시세와 구분된다.
- **P0-4-T6** TARO 호출 입력에 포함된 봉 개수가 4.6절 상한을 넘지 않는다.

---

## 5. 공격 모드의 명시적 격리 (P0-5)

### 5.1 식별자

| 위치 | 값 |
|---|---|
| 내부 모드명 | `forced_direction` |
| 화면 이름 | `강제 방향 시뮬레이션` (보조 표기 `공격`) |
| 결과 등급 | `resultClass: simulation` |
| 리포트 파일명 접미사 | `_SIM` |
| 리포트 헤더 | `강제 방향 시뮬레이션 — 투자 판정이 아닙니다` |

### 5.2 요구사항

- **P0-5-R1 (반드시)** 강제 방향 모드는 브라우저 탭(세션)마다 처음 실행할 때 확인 창을 띄운다. 확인 창에는 "근거가 부족해도 방향을 고르며, 강제가 없었다면 거래하지 않았을 수 있다"는 설명과 명시적 동의 버튼이 있다.
- **P0-5-R2 (반드시)** URL 파라미터, 저장된 기본값, 최근 사용 모드 복원으로 강제 방향 모드가 자동 실행되지 않는다. 사용자가 매번 모드를 직접 골라야 한다.
- **P0-5-R3 (반드시)** 결과 패널 **내부**에 `강제 방향 시뮬레이션` 배지를 둔다. 결과 패널만 캡처해도 배지가 포함되어야 한다.
- **P0-5-R4 (반드시)** 판정 색은 일반 모드의 롱·숏 색과 다른 전용 색(예: 보라 계열)과 전용 아이콘을 쓴다.
- **P0-5-R5 (반드시)** 강제 방향 결과는 과거 판정 회고 입력, 기본 리포트 목록, 성과 통계에서 기본 제외한다. 포함할 때는 별도 집계로만 표시한다. (과거 판정 회고는 P1에서 기본 비활성화되며, 재활성화할 때도 이 제외 규칙을 적용한다)
- **P0-5-R6 (반드시)** "근거 부족" 여부는 확신도 숫자가 아니라 `unforcedAction`으로 판단한다.

| `unforcedAction` | 결과 패널 표기 |
|---|---|
| `NO_TRADE` | `근거 부족 — 강제로 고른 방향` (방향 표시보다 먼저, 같은 크기 이상) |
| 강제 방향과 같음 | `강제 없이도 같은 방향` |
| 강제 방향과 반대 | `강제 없이는 반대 방향 — 신뢰 불가` |

  확신도가 높게 나와도 위 표기를 생략하지 않는다. 프롬프트에는 "방향은 강제되지만 확신도와 `unforcedAction`은 강제와 무관하게 답하라"는 지시를 둔다.
- **P0-5-R7 (반드시)** `/floor <종목> 공격` 실행 결과에도 5.1절의 헤더와 접미사, R6의 표기를 똑같이 적용한다.
- **P0-5-R8 (권장)** 강제 방향 결과 화면에서 "이 종목으로 알고리즘 분석 실행" 같은 일반 모드 전환 동작을 제공하되, 강제 방향 결과를 입력으로 넘기지 않는다.

### 5.3 검증 항목

- **P0-5-T1** `?mode=forced_direction`처럼 URL로 모드를 지정해도 확인 없이 분석이 시작되지 않는다.
- **P0-5-T2** 강제 방향 리포트 파일명에 `_SIM`이 있고 메타데이터에 `resultClass: simulation`이 있다.
- **P0-5-T3** 같은 종목의 다음 알고리즘 분석에서 과거 판정 회고 입력에 강제 방향 리포트 ID가 없다.
- **P0-5-T4** 결과 패널 영역만 캡처한 이미지에 시뮬레이션 배지가 보인다.
- **P0-5-T5** `unforcedAction = NO_TRADE`, 확신도 80인 응답을 주입해도 `근거 부족 — 강제로 고른 방향`이 표시된다.

---

## 6. 외부 데이터 전송 문구 정정 (P0-6)

### 6.1 삭제할 문구

가이드 11장 `이 프로그램이 하지 않는 것`의 다음 문장을 삭제한다.

> 수집한 데이터를 외부로 전송하지 않습니다. 모든 결과는 사용자 PC에만 저장됩니다

실제로 시장 데이터 공급자에게 조회 요청이 가고, 실전 분석 시 분석 자료와 프롬프트가 Claude로 전송되며, LAN 모드에서는 같은 네트워크의 기기가 리포트를 열람할 수 있기 때문이다.

### 6.2 대체 문안 (가이드·앱 안내 화면 공통)

> **데이터가 오가는 곳**
>
> - 이 앱은 시세·뉴스·지표를 보여주고 분석하기 위해 외부 시장 데이터 공급자(Binance, Yahoo Finance, CoinGecko, 뉴스 RSS, 공포탐욕지수, 환율, 거래소별 선물 시세)에 조회 요청을 보냅니다. 이때 조회하는 종목 정보가 해당 공급자에게 전달됩니다.
> - 실전 분석(▶ ANALYZE, `/floor`)을 실행하면 분석에 필요한 시장 데이터와 프롬프트가 Claude Code를 통해 Anthropic의 Claude 서비스로 전송됩니다. 전송된 데이터의 처리와 보존은 사용 중인 Claude 계정 유형의 정책을 따릅니다.
> - 데모 모드(`?demo=1`)는 외부 공급자와 Claude에 요청을 보내지 않습니다.
> - 분석 리포트는 사용자 PC의 `reports/` 폴더에 저장됩니다. 앱은 별도의 운영자 서버로 리포트를 업로드하지 않습니다.
> - LAN 공유 모드를 켜면 접근 토큰을 가진 같은 네트워크의 기기가 화면과 리포트를 볼 수 있습니다. 이 통신은 암호화되지 않습니다.
> - 이 앱은 거래소 API 키, 결제 정보, 계정 비밀번호를 요청하거나 전송하지 않습니다.

### 6.3 데이터 흐름 표

| 데이터 | 출발지 | 목적지 | 목적 | 데모 모드 | 저장 |
|---|---|---|---|---|---|
| 티커·모드 입력 | 브라우저 | 로컬 서버 | 분석 요청 | 발생 | 작업 로그 |
| 시세·캔들·펀딩 조회 요청 | 로컬 서버 | 시장 데이터 공급자 | 데이터 수집 | 차단 | 없음 |
| 시장 데이터 응답 | 공급자 | 로컬 서버 | 스냅샷 생성 | 차단 (fixture 사용) | 리포트 스냅샷 |
| 뉴스 헤드라인 | RSS 공급자 | 로컬 서버 | 뉴스 분석 | 차단 | 리포트 스냅샷 |
| 프롬프트·스냅샷 일부 | 로컬 서버 (Claude Code CLI) | Anthropic Claude | AI 분석 | 차단 | Claude 계정 정책 |
| 모델 응답 | Anthropic Claude | 로컬 서버 | 판정 생성 | fixture | 리포트 |
| 리포트 | 로컬 서버 | 로컬 디스크 | 열람·다운로드 | `demo: true`로 저장 | 저장 |
| 화면·리포트 열람 | 로컬 서버 | LAN 기기 (LAN 모드만, 평문 HTTP) | 공유 열람 | 동일 | 없음 |

- **P0-6-R1 (반드시)** 코드의 실제 네트워크 목적지 목록(도메인 단위)을 부록으로 관리하고, 6.2 문안·6.3 표와 일치시킨다. `[코드 확인 필요]`
- **P0-6-R2 (반드시)** 데모 모드에서는 외부 요청을 코드 수준에서 차단한다. 가이드상 "전광판은 클로드 없이 동작"하므로, 데모 모드에서 전광판이 실제 시세를 조회하는지 확인하고 조회한다면 문안을 그에 맞게 고친다. (v0.8 확인: 데모 전광판은 녹화 fixture로 그리며 외부 요청이 없다. "전광판은 클로드 없이 동작"은 실전 모드 설명이다, P1-8-R5)
- **P0-6-R3 (반드시)** 앱 첫 화면 또는 설정 화면에서 6.2 문안에 한 번의 클릭으로 접근할 수 있다.

### 6.4 검증 항목

- **P0-6-T1** 실전 분석 한 건을 실행하며 캡처한 네트워크 목적지가 모두 부록 목록 안에 있다.
- **P0-6-T2** 데모 모드 실행 중 외부 목적지로 나가는 요청이 0건이다 (또는 문안에 명시된 예외만 있다).

---

## 7. 로컬 전용 모드와 LAN 공유 모드의 보안 경계 (P0-7)

### 7.1 모드 정의

| 항목 | 로컬 전용 (기본) | LAN 공유 (명시적 선택) |
|---|---|---|
| 바인딩 | `127.0.0.1:<PORT>` | `0.0.0.0:<PORT>`. 단 연결은 루프백과 **사설 IPv4**(10/8, 172.16/12, 192.168/16) 인터페이스로 들어온 것만 받는다. 공인 IP·VPN(CGNAT 100.64/10 등)으로 들어온 연결은 끊고, 사설 주소가 없으면 LAN 모드를 시작하지 않는다 |
| 켜는 방법 | 기본값 | 시작 인자 `--lan` 또는 환경변수 `FLOOR_LAN=1` |
| 접근 토큰 | 불필요 | 필수 |
| 허용 Host 헤더 | `localhost:<PORT>`, `127.0.0.1:<PORT>` | 위 + 실행 시 감지한 사설 IPv4 주소 |
| LAN 기기 권한 | 해당 없음 | **읽기 전용** (화면, 시세, 리포트 열람) |
| 시작 시 표시 | 없음 | 서버 창과 앱 상단에 `LAN 공유 중 · 암호화되지 않음` 경고, 접속 URL, 토큰 만료 시각 |

`start-floor.cmd`와 `npm start`는 로컬 전용으로 시작한다. LAN 모드용 실행 파일(예: `start-floor-lan.cmd`)은 별도로 둔다.

### 7.2 알려진 한계: 평문 HTTP

LAN 모드의 통신은 HTTP 평문이다. 같은 네트워크에 있는 사람이 접속 토큰과 세션 쿠키를 가로챌 수 있다. 토큰은 **무단 접근을 막지만 도청은 막지 못한다.** P0에서는 HTTPS를 도입하지 않고(로컬 인증서 배포 부담), 대신 다음으로 피해 범위를 줄인다.

- LAN 기기 권한을 읽기 전용으로 제한해, 토큰을 가로채도 분석 실행(서버 주인의 Claude 사용량 소모)과 일괄 다운로드를 할 수 없게 한다.
- 토큰 수명을 짧게 둔다 (R2).
- **제약 조건:** LAN 모드는 개인 네트워크(가정·사무실의 신뢰할 수 있는 Wi-Fi)에서만 쓴다. 공용·게스트 Wi-Fi, 테더링을 여러 사람이 공유하는 환경에서는 쓰지 않는다. 코드로 강제할 수 없으므로 시작 경고와 가이드에 명시한다.

**로컬 전용 모드의 한계:** 로컬 전용 모드는 인증이 없다. 같은 PC의 다른 프로세스나 다른 OS 사용자 계정은 `127.0.0.1`로 분석 실행(Claude 사용량 소모)과 리포트 열람을 할 수 있다. 이 앱은 개인 PC 한 사용자를 전제로 하며, 여러 사람이 로그인하는 공용 PC에서는 서버를 켜 두지 않는다. 브라우저를 통한 다른 웹사이트의 요청은 R5(Host), R6(Origin), R10(Sec-Fetch-Site)으로 막는다.

### 7.3 LAN 토큰

- **P0-7-R1 (반드시)** 서버 시작마다 128비트 이상 암호학적 난수 토큰을 새로 만든다. 이전 실행의 토큰은 재사용하지 않는다.
- **P0-7-R2 (반드시)** 토큰과 세션 쿠키는 기본 **2시간** 뒤 만료되며, 서버 창에서 즉시 폐기(재발급)할 수 있다. 재발급하면 기존 쿠키는 모두 무효가 된다.
- **P0-7-R3 (반드시)** 최초 접속은 `http://<IP>:<PORT>/?t=<토큰>` 형식으로 하고, 서버는 검증 후 `HttpOnly; SameSite=Strict` 쿠키를 발급한 뒤 토큰 없는 주소로 리디렉션한다. 이후 요청은 쿠키로 인증한다.
- **P0-7-R4 (반드시)** 토큰 값은 서버 로그와 오류 응답에 출력하지 않는다 (시작 시 접속 URL 한 번 제외).

### 7.4 엔드포인트 접근 표

| 경로 | 로컬 전용 | LAN (토큰 인증 기기) |
|---|---|---|
| `/` 화면, 시세 | 허용 | 허용 |
| `/api/analyze` 등 분석 실행 | 허용 | **차단** |
| `/reports` 목록·열람 | 허용 | 허용 |
| `/reports/all.zip` | 허용 | **차단** |
| `/project.zip` | 기본 **비활성**. `--enable-project-zip`일 때 로컬에서만 허용 | 항상 차단 |
| 진단·설정 API | 허용 | 차단 |

- **P0-7-R9 (선택)** LAN 기기의 분석 실행을 여는 `--lan-allow-analyze` 인자를 둘 수 있다. 이 인자는 7.2절 도청 위험을 키우므로 **가이드에 소개하지 않고**, 켜면 서버 창에 별도 경고를 띄운다.

실제 라우트 전체 (v0.7, `src/server/app.ts`의 경로 표). 표에 없는 경로는 **기본 차단**(404)한다. 등급은 `read`(LAN 인증 기기 허용), `analyze`(LAN 차단, R9 인자로만 허용), `local`(LAN 항상 차단).

| 메서드·경로 | 등급 | 용도 |
|---|---|---|
| `GET /`, `GET /web/<파일>`, `GET /favicon.ico` | read | 화면과 정적 파일 (`src/web/`의 고정 이름만) |
| `GET /api/status` | read | 서버 모드, LAN 경고·만료 시각, 이 기기의 읽기 전용 여부, 실행 중 작업, 모드별 계획·최악 호출 수 (P0-1-R6) |
| `GET /api/board?symbol=[&demo=1]` | read | 전광판 시세: 가격·일봉 차트·한국 종목 멀티 거래소 (가이드 4-1·4-4). 공급자 조회는 종목별 15초 캐시로 묶고, 데모는 녹화 fixture만 쓴다 (P1-8-R5) |
| `POST /api/analyze` | analyze | 분석 실행 (idempotency key, P0-8-R4·R5) |
| `GET /api/jobs/<jobId>`, `/snapshot`, `/events`(SSE) | read | 작업 진행 보기 |
| `POST /api/jobs/<jobId>/cancel` | analyze | 분석 취소 (P0-8-R6) |
| `GET /api/reports?tab=`, `GET /reports?tab=`, `GET /reports/<jobId>[.md\|.json]` | read | 리포트 목록·열람·파일 (ID 조회, R8) |
| `GET /reports/all.zip` | local | 분석 탭 리포트 일괄 (P1-7-R15) |
| `GET /project.zip`, `GET /api/project-zip/files` | local + `--enable-project-zip` | 포함 목록 확인 뒤 `?confirm=<목록 해시>`로만 생성 (P1-7-R14) |
| `GET /diagnostics`, `POST /diagnostics/claude-test`, `GET /api/diagnostics` | local | 통합 진단 (P1-8.2) |
| `POST /api/lan/rotate` | local | LAN 토큰 재발급 (서버 창의 `r` + Enter와 같음) |

LAN 세션 쿠키는 발급 시각과 관계없이 **토큰의 만료 시각**에 함께 만료된다 (접속 가능 기간이 토큰 발급 뒤 2시간을 넘지 않는다). R7의 분석 실행 한도는 접근 등급과 `Origin` 검사를 통과한 요청만 세고, 모든 요청은 분당 120회 한도에 함께 들어간다.

### 7.5 공통 방어 (두 모드 모두)

- **P0-7-R5 (반드시)** 모든 요청의 `Host` 헤더를 허용 목록과 비교해 DNS 리바인딩을 막는다.
- **P0-7-R6 (반드시)** 상태를 바꾸는 요청(POST 등)은 `Origin` 헤더가 허용 출처와 같을 때만 처리한다.
- **P0-7-R7 (반드시)** 요청 횟수를 제한한다. 초기값: 분석 실행 IP당 분당 3회, 그 외 IP당 분당 120회.
- **P0-7-R8 (반드시)** `/reports` 파일 접근은 경로 문자열이 아니라 리포트 ID로 조회하고, 정규화된 경로가 `reports/` 루트 밖이면 거부한다. (링크를 따라간 실제 경로 기준, 목록에도 같은 검사를 적용한다)
- **P0-7-R10 (반드시)** 다른 사이트가 사용자 브라우저를 통해 보내는 요청을 거부한다. `Sec-Fetch-Site`가 `cross-site`·`same-site`이면 `/`로의 최상위 페이지 이동(`Sec-Fetch-Mode: navigate`, `Sec-Fetch-Dest: document`)만 허용하고, 요청 횟수를 세기 전에 거부한다. 이유: 다른 사이트의 `<img>` 요청도 Host는 정상 값이라 R5를 통과하고, GET이라 R6도 적용되지 않는데, ZIP 생성·진단(외부 요청과 claude 실행)·요청 한도 소진 같은 부작용이 있다. 모든 응답에 `Cross-Origin-Resource-Policy: same-origin`, `Cross-Origin-Opener-Policy: same-origin`을 붙인다.
- **P0-7-R11 (반드시)** 자원 상한을 둔다: 동시 연결 256, 진행 이벤트(SSE) 연결 IP당 8·전체 64, 요청 헤더 수신 15초·요청 수신 30초, LAN 세션 200개(넘으면 오래된 것부터 폐기). ZIP은 파일을 하나씩 비동기로 압축해 흘려 쓰고 한 번에 하나만 만든다.

### 7.6 가이드 수정

가이드 9장 `다른 PC나 휴대폰에서 보기`는 "기본 실행으로 접속된다"는 전제를 없애고 다음 순서로 바꾼다.

1. 집·사무실의 신뢰할 수 있는 Wi-Fi인지 확인한다. 공용·게스트 Wi-Fi에서는 쓰지 않는다.
2. `start-floor-lan.cmd`로 실행한다.
3. 서버 창에 표시된 접속 주소(토큰 포함)를 다른 기기에서 연다. 주소는 2시간 뒤 만료된다.
4. 다른 기기에서는 화면과 리포트를 **보기만** 할 수 있다. 분석 실행은 서버 PC에서 한다.
5. 방화벽 허용은 **개인 네트워크**에만 한다.

### 7.7 검증 항목

- **P0-7-T1** 기본 실행에서 같은 네트워크의 다른 기기가 접속할 수 없다.
- **P0-7-T2** LAN 모드에서 토큰 없이 접속하면 401, 만료 토큰·만료 쿠키는 401이다.
- **P0-7-T3** `Host: evil.example` 요청은 두 모드 모두 거부된다.
- **P0-7-T4** LAN 기기에서 `/reports/all.zip`, `/project.zip`, 분석 실행이 차단된다.
- **P0-7-T5** `/reports/..%2f..%2fpackage.json` 같은 경로 이동 요청이 거부된다.
- **P0-7-T6** 토큰을 재발급하면 기존 쿠키로 보낸 요청이 401이 된다.
- **P0-7-T7** `Sec-Fetch-Site: cross-site`인 `/reports/all.zip`·`/diagnostics` 요청이 403이고 진단이 실행되지 않으며, 교차 사이트 요청을 한도 이상 보내도 사용자의 요청이 429가 되지 않는다.
- **P0-7-T8** LAN 모드에서 고른 사설 주소가 아닌 인터페이스로 들어온 연결이 끊기고, 사설 주소가 없으면 LAN 모드가 시작되지 않는다.

---

## 8. 분석 한 건당 호출·토큰·시간·재시도 상한 (P0-8)

### 8.1 예산 필드

보완안 10.1의 필드를 다음 단위로 확정한다. 토큰 수는 CLI 경로에서 정확히 측정하기 어려우므로 P0에서는 **문자 수**로 제한하고, P1에서 토큰 계측이 가능해지면 토큰 상한을 추가한다. 한국어는 대략 1~2자가 1토큰이므로 문자 상한은 토큰 기준으로 보수적으로 잡는다.

| 필드 | 단위 | 의미 |
|---|---|---|
| `maxModelCalls` | 회 | 재시도 포함 작업당 최대 호출 수 |
| `maxRetriesPerCall` | 회 | 한 역할 호출의 최대 재시도 수 |
| `maxRetriesPerJob` | 회 | 작업 전체 재시도 합계 상한 |
| `maxInputChars` | 문자 | 호출 한 번의 입력(시스템 지침 + 데이터) 최대 길이 |
| `maxOutputChars` | 문자 | 호출 한 번의 출력 최대 길이. 초과분은 잘라내고 `SCHEMA_ERROR` 후보로 처리 |
| `callTimeoutSeconds` | 초 | 호출 한 번의 시간 제한 |
| `maxDurationSeconds` | 초 | 작업 전체 시간 제한 |
| `maxConcurrentJobs` | 개 | 서버 전체 동시 실행 작업 수 |

### 8.2 시간 상한 산식

시간 상한을 고정 숫자로 두면 정상 실행을 끊거나 비정상 실행을 방치한다. 알고리즘 모드는 순차 단계가 약 10개(애널리스트 병렬 1단계 → 토론 최대 4발언 → ACE → 리스크 3명 → PM)이고, 호출마다 CLI 프로세스 시작 시간이 더해진다. 단계당 40~60초만 걸려도 400~600초가 되므로, v0.1의 600초 상한은 재시도 한 번에 정상 작업을 끊는다.

따라서 다음 산식으로 정한다.

```text
callTimeoutSeconds(역할) = 해당 역할 호출 시간 실측 p99 × 1.5
maxDurationSeconds(모드) = Σ(순차 경로 단계별 실측 p95) + max(callTimeoutSeconds)   # 뒤 항은 재시도 1회분 여유
```

**측정 절차** (수행은 P1 명세 11장): 지원 환경(보완안 8.1)에서 모드별 10회 이상 실행해 역할별 호출 시간(프로세스 시작부터 응답 파싱 완료까지)을 기록한다. 측정값과 산출 상한은 이 문서 부록에 기록하고, 모델이나 프롬프트가 바뀌면 다시 측정한다.

### 8.3 모드별 상한 (측정 전 임시값)

| 필드 | `algorithm` | `scalp` | `forced_direction` |
|---|---|---|---|
| `plannedModelCallRange` | 11~13 | 5 | 5 |
| `maxRetriesPerCall` | 1 | 1 | 1 |
| `maxRetriesPerJob` | 4 | 2 | 2 |
| `maxModelCalls` | 17 | 7 | 7 |
| `maxInputChars` | 20,000 | 20,000 | 20,000 |
| `maxOutputChars` | 6,000 (ACE·PM 10,000) | 6,000 | 6,000 |
| `callTimeoutSeconds` | 120 | 90 | 90 |
| `maxDurationSeconds` | 900 | 300 | 300 |
| `maxConcurrentJobs` | 1 (서버 전체, 모드 공통) | ← | ← |

임시값은 8.2절 측정이 끝나면 산식 결과로 교체한다. 측정 결과 입력 20,000자로 필수 데이터를 담을 수 없는 역할이 있으면, 상한을 올리기 전에 4.6절 입력 범위를 먼저 줄인다.

### 8.4 재시도 대상

| 오류 | 재시도 | 비고 |
|---|---|---|
| 호출 시간 초과 | 예 | 같은 입력으로 1회 |
| JSON 파싱·스키마 오류 | 예 | 오류 요약을 덧붙여 1회 |
| CLI 프로세스 비정상 종료 | 예 | 1회 |
| 인증 실패, 로그인 만료 | 아니오 | 즉시 `FAILED` + 진단 안내 |
| 사용량 한도 초과 응답 | 아니오 | 즉시 `FAILED` |
| 사용자 취소 | 아니오 | `CANCELLED` |

재시도 간격은 2초, 4초로 지수 증가한다.

### 8.5 요구사항

- **P0-8-R1 (반드시)** 다음 호출을 시작하기 전에 `modelCallCount < maxModelCalls`, 경과 시간 `< maxDurationSeconds`, 재시도 예산이 남았는지 확인한다. 하나라도 넘으면 호출하지 않고 `BUDGET_EXCEEDED`로 끝낸다.
- **P0-8-R2 (반드시)** `BUDGET_EXCEEDED`·`FAILED`·`CANCELLED` 작업의 부분 결과는 `status`를 명시해 보존할 수 있지만, 판정 패널에 정상 판정으로 표시하지 않는다.
- **P0-8-R3 (반드시)** 입력이 `maxInputChars`를 넘으면 뉴스 요약 → 과거 판정 회고 → 최근 봉 개수 순으로 줄이고, 줄인 사실을 경고로 기록한다. 필수 데이터를 줄여야 할 만큼 크면 `BUDGET_EXCEEDED`로 끝낸다.
- **P0-8-R4 (반드시)** 분석 요청에는 클라이언트가 만든 idempotency key를 붙인다. 같은 키의 재요청은 새 작업을 만들지 않고 기존 작업 상태를 돌려준다.
- **P0-8-R5 (반드시)** `maxConcurrentJobs`를 넘는 요청은 대기열에 넣지 않고 "실행 중인 분석이 있습니다" 응답과 실행 중 작업 정보를 돌려준다.
- **P0-8-R6 (반드시)** 취소나 시간 초과 시 실행 중인 Claude 하위 프로세스를 프로세스 트리 단위로 종료하고, 종료 확인 뒤 작업 상태를 확정한다. (Windows에서는 `taskkill /T /F` 또는 동등한 방식) `[코드 확인 필요]`
- **P0-8-R7 (반드시)** 리포트에 계획 호출 수 범위, 실제 호출 수, 재시도 수, 총 소요 시간, 호출별 소요 시간과 입력·출력 문자 수를 기록한다. 이 기록이 8.2절 측정의 원자료가 된다.

`/floor` 경로의 예산 처리는 9장을 따른다.

### 8.6 검증 항목

- **P0-8-T1** 모든 호출이 스키마 오류를 내도록 조작하면 알고리즘 작업이 최대 17회 이하의 호출로 `BUDGET_EXCEEDED` 또는 `SCHEMA_ERROR`로 끝난다.
- **P0-8-T2** 분석 버튼을 빠르게 5회 누르면 작업이 1개만 생성된다.
- **P0-8-T3** 실행 중 취소하면 5초 안에 모든 `claude` 하위 프로세스가 사라진다.
- **P0-8-T4** 로그인 만료 상태에서 재시도 없이 1회 호출 후 `FAILED`가 되고 진단 안내가 표시된다.
- **P0-8-T5** 정상 조건 10회 실행 중 `BUDGET_EXCEEDED`로 끝나는 작업이 없다 (시간 상한이 정상 실행을 끊지 않음).

---

## 9. `/floor` 실행 경로 (P0-F)

### 9.1 문제

가이드는 `/floor`를 "사용량이 가장 적게 드는 방법"으로 추천한다. 그러나 현재 설명대로 Claude 세션 하나가 모든 역할을 연기하면 다음을 구조적으로 지킬 수 없다.

| 요구사항 | `/floor`에서 깨지는 이유 |
|---|---|
| 스냅샷 고정 (P0-4) | 세션이 분석 도중 웹 조회·파일 읽기 등으로 데이터를 직접 가져올 수 있다 |
| 독립 분석 (보완안 11.1) | TARO를 연기한 같은 문맥이 DIANA도 연기하므로 앞선 결론이 뒤 역할에 그대로 보인다 |
| 판정 검증 (P0-3) | 세션이 쓴 판정을 코드가 검증하는 단계가 없다 |
| 예산 상한 (P0-8) | 호출 수·시간을 프로세스 단위로 강제할 수 없다 |

가이드가 이 경로를 추천하므로 사용자 다수가 가장 검증이 약한 경로를 쓰게 된다. 문서 설명으로 덮지 않고 구조를 바꾼다.

### 9.2 결정

`/floor`도 공통 코어를 쓴다 (보완안 3.11). 세션은 **역할 발언만** 맡고, 데이터 수집·스냅샷·검증·규칙 엔진·리포트 저장은 브라우저 경로와 같은 Node 코드가 수행한다.

```text
/floor <종목> <모드>
  1. node <core> snapshot --symbol <종목> --mode <모드>   → 스냅샷 파일 + 역할별 입력 파일
  2. 세션이 역할별 입력 파일만 읽고 역할별 출력 JSON 작성
  3. node <core> finalize --job <jobId>                     → 스키마 검증, 규칙 엔진, 리포트 저장
```

보완안 v1.2 5.0절의 기준에 따라 이 장의 요구사항은 두 등급으로 나뉜다.

| 구분 | 요구사항 | 완료 시점 |
|---|---|---|
| P0: 과도기 분류 | 9.3절 P0-F-R7~R9 | P0 완료 조건 |
| P1: 구조 전환 계약 | 9.4절 P0-F-R1~R6 | P1 완료 조건 (구현 상세는 P1 명세 5장) |

구조 전환이 끝나기 전까지 모든 `/floor` 결과는 9.3절의 과도기 분류를 따른다.

### 9.3 P0 요구사항: 과도기 분류

- **P0-F-R7 (반드시)** 9.4절 구조가 구현되기 전의 `/floor` 결과는 `resultClass: lightweight`로 저장하고, 리포트 헤더와 결과 표시에 `간이 분석 — 데이터 고정·판정 검증 미적용`을 표시한다.
- **P0-F-R8 (반드시)** `lightweight` 결과는 과거 판정 회고 입력, 기본 리포트 목록, 성과 통계에서 제외한다.
- **P0-F-R9 (반드시)** 가이드의 "사용량을 아끼는 방법" 설명에 이 한계를 함께 적는다.

### 9.4 P1 구현 계약: 구조 전환

아래 요구사항은 P0에서 계약으로 확정하고 P1에서 구현한다. 모두 충족하면 `/floor` 결과는 `lightweight`가 아니라 모드에 맞는 `analysis` 또는 `simulation`으로 분류된다.

- **P0-F-R1 (반드시, P1 구현)** `/floor`의 데이터 수집은 공통 코어의 스냅샷 명령으로만 한다. `/floor` 명령 정의에서 세션의 웹 조회 도구 사용을 허용하지 않는다.
- **P0-F-R2 (반드시, P1 구현)** 세션의 역할 출력은 공통 코어의 `finalize` 명령을 거쳐야 리포트가 된다. 세션이 리포트 파일을 직접 쓰지 않는다.
- **P0-F-R3 (반드시, P1 구현)** 공통 코어는 역할별 입력 파일을 4.6절 범위로 따로 만든다. 애널리스트 4명의 입력 파일에는 다른 애널리스트의 결론이 없다.
- **P0-F-R4 (반드시, P1 구현)** 명령 인자(종목, 모드)는 공통 코어의 입력 검증을 거친 뒤에만 쓰며, 셸 문자열에 이어 붙이지 않는다 (보완안 9.3).
- **P0-F-R5 (반드시, P1 구현)** `finalize`는 역할별 출력 개수가 `plannedModelCallRange.max`를 넘거나 스냅샷 생성 뒤 `maxDurationSeconds`가 지났으면 `BUDGET_EXCEEDED`로 처리한다. 세션 안의 사용량 자체는 강제할 수 없음을 리포트에 `budgetEnforcement: partial`로 기록한다.
- **P0-F-R6 (반드시, P1 구현)** 같은 세션 문맥이 여러 역할을 수행하므로 애널리스트 독립성은 완전하지 않다. 리포트에 `analystIndependence: shared_context`를 기록하고, 결과 패널에 `단일 세션 분석`을 표시한다.

### 9.5 검증 항목

- **P0-F-T0** (P0) 구조 전환 전 `/floor` 결과의 메타데이터가 `resultClass: lightweight`이고 기본 리포트 목록에 나타나지 않는다.
- **P0-F-T1** (P1) `/floor` 실행 리포트의 `snapshotHash`가 스냅샷 파일의 해시와 같다.
- **P0-F-T2** (P1) 세션 출력에서 롱 제안의 손절가를 진입가 위로 조작하면 `finalize`가 `NO_TRADE` + `V-DIR-LONG`으로 처리한다.
- **P0-F-T3** (P1) 같은 스냅샷을 브라우저 경로와 `/floor`에 주입하면 두 리포트의 단계 수, 검증 규칙, 스키마가 같다 (자연어 결과 일치는 요구하지 않음).
- **P0-F-T4** (P1) `/floor` 실행 중 세션의 웹 조회 도구 호출이 0건이다.

---

## 10. 추적 매트릭스

| P0 | 핵심 요구사항 | 보완안 7장 승인 질문 |
|---|---|---|
| 1 | R1, R3, R4, R6 | 한 번의 분석에 모델 호출이 정확히 몇 번 발생하는가? |
| 2 | R1, R2, R4 | 각 모드의 최종 승인자는 누구인가? |
| 3 | R1, R2, R4, R6 | 모델 출력이 수치·형식 검증을 통과했는가? 근거 부족 시 거래하지 않는 결과를 낼 수 있는가? |
| 4 | R1, R3, R4, R6, R8 | 모든 에이전트가 같은 스냅샷을 쓰는가? 가격의 시장·통화·시각을 알 수 있는가? 추정 시세가 쓰였는지 알 수 있는가? |
| 5 | R1~R6 | 공격 모드가 일반 분석과 확실히 구분되는가? |
| 6 | R1, R2 | 실제 외부 전송 데이터와 문서 안내가 일치하는가? |
| 7 | R1, R2, R5, R8 | (보완안 9.5 보안 통과 기준) |
| 8 | R1, R4, R6 | 실패·취소·재시도·동시 실행 결과를 추적할 수 있는가? |
| 9 (F) | P0: R7, R8, R9 / P1 구현: R1, R2, R3 | 모든 에이전트가 같은 스냅샷을 쓰는가? (`/floor` 포함) |

보완안 7장의 마지막 질문(리포트에서 앱·프롬프트·스냅샷·위험 규칙 버전 추적)은 P1 명세 6장(리포트 저장과 버전 추적)에서 다룬다. P0에서는 `schemaVersion`과 `snapshotHash`까지만 정의했다.

---

## 11. 결정 기록

### 11.1 확정한 결정

| ID | 결정 | 근거 | 기각한 대안 |
|---|---|---|---|
| D1 | 토론은 최대 2라운드, 1라운드 뒤 조기 종료 가능 (11~13회) | 같은 모델의 역할 토론은 라운드가 늘수록 반복·쏠림 위험이 크고, 토론의 기여도가 아직 검증되지 않음 | 4라운드 고정 (17회, 비용·시간 +30%) |
| D2 | 모드별 최종 의사결정자 분리 (알고리즘 PM, 스캘핑 ACE) | 보완안 3.2 권장안 | 모든 모드에 PM 추가 (+1회 호출) |
| D3 | 포지션 입력을 두지 않고 행동을 3개로 제한 | 개인 맞춤 조언화, 개인 금융 정보 처리 부담 회피 | 보유 유지·청산 판정 추가 |
| D4 | 추정 시세는 판정 기준으로 쓰지 않음 | 보완안 3.10 권장안 | 조건부 허용 (보완안 v1.2에서 폐기) |
| D5 | 강제 방향 모드에서도 데이터 부족이면 결과를 만들지 않음 | "근거 없는 데이터"와 "근거 부족한 판단"은 다름 | 데이터 부족이어도 방향 생성 |
| D6 | LAN 기기는 읽기 전용, 분석 실행 차단 | 평문 HTTP로 토큰 도청 가능. 도청된 토큰으로 서버 주인의 Claude 사용량 소모 방지 | LAN에서도 분석 허용 |
| D7 | P0 입력·출력 상한을 문자 수로 정의, 입력 20,000자 | CLI 경로에서 토큰 계측 불확실, 한국어 토큰 밀도 | 처음부터 토큰 상한, 입력 40,000자 |
| D8 | 동시 실행 작업을 서버 전체 1개로 제한 | 로컬 단일 사용자 앱, 사용량 보호 | 모드별 1개 |
| D9 | 행동(`action`)과 방향 판단(`bias`) 분리 | 현물 약세 판단이 `NO_TRADE`에 묻혀 정보가 사라지는 문제 해결 | SELL → `NO_TRADE` 단순 변환 (v0.1) |
| D10 | 공격 모드의 근거 부족 판단은 `unforcedAction`으로 | 보정 전 확신도는 확률이 아니며, 숫자 경계는 임의적이고 높은 점수가 "근거 충분"으로 오독됨 | 확신도 60 미만 경계 (v0.1) |
| D11 | 보정 전 확신도는 3단계 표시만, 규칙에 사용 금지 | 숫자·%가 적중 확률로 오해됨 (가이드의 "54% = 동전 던지기" 해석이 그 예) | 숫자 게이지 유지 |
| D12 | 시간 상한은 실측 기반 산식, 임시값 900초/300초 | 600초는 순차 10단계 + 재시도 1회에 정상 작업을 끊음 | 고정 600초/240초 (v0.1) |
| D13 | 기술 지표는 코드 계산, 모델에는 지표와 최근 30봉 내외만 | 입력 크기 절감, 계산 정확성, 보완안 10.3 | 캔들 원본 전달 |
| D14 | LAN 토큰 만료 2시간, 평문 HTTP 한계 명시 | 도청 시 노출 시간 축소. HTTPS는 P0 범위 밖 | 8시간 (v0.1), 로컬 HTTPS 도입 |
| D15 | `/floor`도 공통 코어 사용. P0는 `lightweight` 과도기 분류, 구조 전환 구현은 P1 | 가장 많이 쓰일 경로가 가장 검증이 약한 문제. 계약(P0)과 구현(P1)의 순서 분리 (보완안 v1.2 5.0절) | 한계만 가이드에 적기 (v0.1), 구조 전환을 P0에서 구현 (v0.2) |

### 11.2 남은 불확실성

v0.1의 확인 필요 사항은 모두 결정으로 바꿨다. 다만 다음은 결정이 아니라 **측정이나 코드 확인으로만** 풀린다.

1. **토론 조기 종료 규칙의 타당성 (D1):** `openIssues`와 `evidenceRefs` 기준이 실제로 불필요한 라운드만 걸러내는지는 P2 비교로 확인한다. 모델이 습관적으로 `openIssues`를 채우면 조기 종료가 거의 일어나지 않을 수 있다.
2. **`unforcedAction`의 정직성 (D10):** 같은 호출 안에서 방향을 강제받은 모델이 "강제가 없었다면"을 편향 없이 답하는지 보장할 수 없다. 표본 작업에서 같은 스냅샷을 `scalp` 모드로도 돌려, ACE 행동과 `unforcedAction`이 일치하는 비율을 측정한다. 일치율이 낮으면 별도 호출로 분리하는 방안을 검토한다 (+1회).
3. **`bias` 표시의 오독 위험 (D9):** `거래 없음 · 약세 전망`을 보유분 매도 권유로 읽는 사용자가 있을 수 있다. 판정 패널에 "보유 여부를 모르는 상태의 시장 방향 판단"이라는 설명을 붙이는 것으로 P0를 통과시키고, 사용자 반응을 보고 문구를 조정한다.
4. **시간·입력 상한 (D7, D12):** 임시값이다. 8.2절 측정 전에는 P0-8-T5를 통과했다고 볼 수 없다.
5. **`/floor` 구조 전환의 실현 가능성 (D15):** `/floor` 명령 정의가 Node 스크립트 실행과 도구 제한을 지원하는지 코드에서 확인해야 한다. 상세는 P1 명세 5장.

### 11.3 코드 확인이 필요한 사항

소스 코드가 들어오면 다음을 먼저 대조한다 (보완안 6장 체크리스트 중 P0 관련 항목).

- [ ] 토론 루프의 실제 발언 수와 재시도 유무 (1.1절)
- [x] 서버 바인딩 주소와 전체 라우트 목록 (7.4절, v0.7)
- [ ] 외부 네트워크 목적지 도메인 목록 (6.3절)
- [x] 데모 모드의 외부 요청 여부, 특히 전광판 (6.3절 R2, v0.8)
- [ ] Claude 호출 방식(`claude -p` 인자 구성, 셸 경유 여부)과 취소 시 프로세스 종료 방식 (8.5절 R6)
- [ ] 응답 파싱 방식과 현재 판정 필드 (3장)
- [ ] 데이터 수집이 작업당 1회인지, 에이전트별로 따로 조회하는지 (4장)
- [ ] 기술 지표를 코드로 계산하는지, 캔들 원본을 모델에 넘기는지 (4.6절)
- [x] 공격 모드가 URL 파라미터로 실행 가능한지 (5.2절 R2, v0.8: 불가)
- [ ] `/floor` 명령 정의 파일의 구조, 허용 도구, 데이터 조회 방식 (9장)

## 12. 가이드 v1.3 반영 목록

이 명세를 확정하면 가이드에서 바꿔야 할 문구:

| 가이드 위치 | 현재 | 변경 |
|---|---|---|
| 표지 | 리스크 위원회의 심사와 포트폴리오 매니저의 승인을 거쳐 | 끝에 `(알고리즘 모드 기준)` 추가 |
| 3장 흐름도 | 리서치 토론 (4턴 순차) | 리서치 토론 (최대 2라운드) |
| 3장 흐름도 | BUY / SELL / HOLD | 롱 진입 / 숏 진입 / 거래 없음 + 강세·약세·중립 전망 |
| 5장 모드 표 | 공격 | 강제 방향 시뮬레이션 (공격) |
| 5장 모드 표 | HOLD 가능, PASS 가능 | 거래 없음 가능 |
| 5장 모드 표 AI 호출 | 13회, 5회 | 11~13회 (최대 17회), 5회 (최대 7회) |
| 5장 공격 모드 경고 | 확신도 54% … 동전 던지기와 다르지 않습니다 | 확신도는 적중 확률이 아님을 설명하고, `강제 없이는 거래 없음` 표시를 보라는 안내로 교체 |
| 8장 `/floor` | 사용량이 가장 적게 듭니다 | 9장 구조 구현 전에는 `간이 분석`이며 데이터 고정·판정 검증이 적용되지 않는다는 설명 추가 |
| 9장 | 기본 실행 후 IP로 접속 | 7.6절 절차로 교체 (개인 네트워크 한정, 읽기 전용, 2시간 만료) |
| 10장 문제 해결 | 너무 느리다 … 13회 호출로 수 분 | 11~13회 호출, 최대 15분 |
| 11장 | 수집한 데이터를 외부로 전송하지 않습니다 | 6.2절 문안으로 교체 |
| 11장 20배 레버리지 | 약 5% 역행하면 청산 | `단순 근사치이며 실제 청산가는 거래소·수수료·유지증거금에 따라 다름` 추가 (위험 거리 표시 방식은 P1 명세 4장) |
