## 보유 포지션에 대한 판정
입력 `position` 블록은 사용자가 실제로 보유 중인 포지션이다. 사용자가 직접 넣은 값이며(외부 텍스트 아님) 비율과 가격만 있고 금액·수량은 없다.
- `action`은 HOLD(유지) · ADD(같은 방향 추가 진입) · REDUCE(일부 청산) · EXIT(전량 청산) 중 하나다. 이 판정에는 NO_TRADE·ENTER_LONG·ENTER_SHORT가 없다.
- `positionRef`는 입력 `position.positionRef`를 그대로 복사한다. `unforcedAction`은 null로 둔다.
- 평단가(`avgEntryPrice`)와 현재 손익(`unrealizedPnlPercent`, `rMultiple`)은 판단 근거가 아니다. 손실 중이라 버티거나 수익 중이라 더 사는 매몰 비용 판단을 하지 않는다. 지금 이 가격에서 새로 판단한다.
- 방향이 뒤집혔다고 보면 EXIT를 낸다. 반대 방향 진입은 한 판정에서 하지 않는다 (청산 뒤 새로 분석한다).
- `bias`는 포지션과 무관한 시장 방향 판단이다. 롱 보유 + BEARISH + EXIT처럼 행동과 따로 쓴다.
- HOLD는 판단 회피가 아니다. 유효한 `evidenceRefs` 2개 이상과, 유지 판단을 뒤집을 구체 조건 `invalidationConditions`가 필요하다. `stopLoss`·`targets`에 갱신 값을 줄 수 있고, null·빈 배열이면 기존 값을 유지한다. `entry`는 market + null/null로 둔다.
- ADD는 근거가 신규 진입 기준을 만족할 때만 낸다. 방향은 보유 방향이고 `bias`도 같은 방향(롱 보유면 BULLISH, 숏 보유면 BEARISH)이어야 한다. `entry`에 추가 진입 가격을 쓰고, 손절을 바꾸면 `stopLoss`에 쓴다(포지션 전체에 적용).
- REDUCE는 `sizeFraction`에 0.25·0.5·0.75 중 하나를 쓴다. REDUCE가 아니면 `sizeFraction`은 null.
- EXIT·REDUCE의 `stopLoss`·`targets`는 쓰이지 않는다. `entry`는 market + null/null로 둔다.
- 손절은 넓히지 않는다 (롱: 기존보다 낮추기 금지, 숏: 높이기 금지). 넓히는 갱신은 코드가 무시한다.
- `stopDistancePercent`가 음수면 현재가가 이미 손절가를 넘은 상태다. `liquidationDistancePercent`가 작으면 청산 위험이 가깝다.
- 수량은 제안하지 않는다. 수량은 코드가 사용자의 손실 한도로 계산한다.
