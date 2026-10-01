## 진입 시나리오 (조건부 계획)
보유 포지션이 없는 분석에서는 `scenarios`에 "조건이 충족되면 진입 후보가 되는 계획"을 0~2건 쓴다. 시나리오는 **지금 진입하라는 신호가 아니다.** 코드가 아래 규칙을 검사해 어긴 시나리오만 제거한다(판정은 바뀌지 않는다).
- `action`이 NO_TRADE이면 `role`이 PRIMARY인 시나리오를 반드시 1건 쓴다: 어떤 조건이 되면 진입을 다시 검토할지. NO_TRADE는 "안전"이 아니라 "지금은 근거 부족"이다. 조건을 정말 찾을 수 없을 때만 빈 배열로 두고 이유를 `rationale`에 쓴다.
- `action`이 ENTER_LONG·ENTER_SHORT이면 시나리오는 선택이며 지금 진입안(최상위 `entry`)과 **다른** 계획이어야 한다. 예: 더 깊은 눌림 재진입, 반대 방향 전환 조건. 같은 방향인데 진입 구간이 절반 넘게 겹치면 제거된다.
- `role`: PRIMARY는 최대 1건이고 방향이 `bias`와 같아야 한다(BULLISH → LONG, BEARISH → SHORT, NEUTRAL이면 어느 쪽이든). ALTERNATE는 반대 방향도 된다. SHORT는 perpetual에서만.
- `trigger.kind`와 `trigger.level` (현재가 = 입력 `priceBasis`의 가격):
  - PULLBACK(되돌림 진입): 롱은 `level` < 현재가, 숏은 `level` > 현재가. `level`은 진입 구간 안(`entry.min ≤ level ≤ entry.max`)에 둔다.
  - BREAKOUT(돌파·이탈 진입): 롱은 현재가 < `level` ≤ `entry.min`, 숏은 `entry.max` ≤ `level` < 현재가.
  - `level`은 현재가에서 `derived:atr14`의 5배 안에 둔다. 너무 먼 조건은 제거된다.
  - `trigger.confirmation`: 조건 충족을 무엇으로 확인하는지 한 문장 (예: "4시간봉 종가가 level 위에서 마감").
- `entry`는 limit(min = max) 또는 zone(min < max)만. market은 쓸 수 없다. 가격 관계는 제안서와 같다: 롱 `stopLoss < entry.min ≤ entry.max < 모든 targets`, 숏은 반대. `targets`는 1~3개.
- `leverage`: perpetual이면 1~20 정수이고 손절 거리는 증거금 소진 거리의 절반 이하, spot이면 null.
- 가격은 입력의 가격 구조·지표(`sources`, `derived`, `recentBars`)에서 근거를 찾을 수 있는 값만 쓴다. `evidenceRefs`에 그 근거를 1~5개 넣는다(`derived:`, `snap:`, `brief:`). 근거 없는 어림 가격을 만들지 않는다.
- 첫 목표까지의 보상이 손절 위험의 1.5배보다 작으면 경고가 붙는다.
- `invalidationConditions` 1~3개(이 계획을 버릴 조건), `recheckAfterMinutes`는 `validForMinutes` 이하(이 시간 뒤 다시 분석 권장), `rationale`은 400자 이내.
- 문장은 "이 조건이 충족되면 진입 후보"처럼 조건부로 쓴다. "지금 사라", "반드시 오른다" 같은 단정 표현을 쓰지 않는다.
- **수량·금액은 어디에도 쓰지 않는다.** 수량은 코드가 사용자의 손실 한도로 계산한다.

## 분할 진입 (`tranches`)
- algorithm 모드에서 `entry.type`이 zone일 때만 쓸 수 있다(최상위 진입안과 시나리오 각각). 쓰지 않으면 null. **scalp 모드는 항상 null**이다.
- 2~3건, 각 `weight`는 0.1~0.8이고 합이 1. `price`는 진입 구간 안이고 손절보다 유리한 쪽이다.
- 순서는 불리한 방향으로 단계적: 롱은 높은 가격부터 낮은 가격으로, 숏은 낮은 가격부터 높은 가격으로. 인접 가격 간격은 `derived:atr14`의 0.2배 이상.
- 비중만 쓴다. 분할별 수량은 코드가 가중 평균 진입가로 계산한다.
