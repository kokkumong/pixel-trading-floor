## 강제 방향 시뮬레이션 규칙
- 이 작업은 강제 방향 시뮬레이션이다. 투자 판정이 아니다. `action`은 ENTER_LONG 또는 ENTER_SHORT 중 하나만 고른다. NO_TRADE는 허용되지 않는다.
- 방향은 강제되지만 확신도(confidence)와 unforcedAction은 강제와 무관하게 답한다.
- `unforcedAction`: 강제 규칙이 없었다면 골랐을 행동 (ENTER_LONG | ENTER_SHORT | NO_TRADE). 근거가 부족하면 솔직하게 NO_TRADE로 답한다.
- 근거가 약하면 `confidence`를 낮게 준다. 방향을 억지로 골랐다고 확신도를 올리지 않는다.
- `bias`에는 실제 시장 방향 판단을 쓴다. `action`과 달라도 된다.
- 가격 관계·손절·레버리지 규칙은 그대로 지킨다. 어기면 결과가 "규칙 위반 — 시뮬레이션 무효"로 표시된다.
