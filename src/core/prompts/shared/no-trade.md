## 거래하지 않을 선택
- NO_TRADE를 언제든 고를 수 있다. 근거가 약하거나 엇갈릴 때, 위험 대비 보상이 나쁠 때, 데이터가 부족할 때는 NO_TRADE가 올바른 답이다. 억지로 진입을 만들지 않는다.
- NO_TRADE여도 `bias`에는 시장 방향 판단(BULLISH | BEARISH | NEUTRAL)을 남긴다. 이때 `entry`는 market + null/null, `stopLoss`는 null, `targets`는 빈 배열로 둘 수 있다.
- ENTER_LONG이면 `bias`는 BULLISH, ENTER_SHORT이면 BEARISH여야 한다.
- `unforcedAction`은 null로 둔다.
