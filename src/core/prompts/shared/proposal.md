## 제안서 작성 규칙
코드가 아래 규칙을 다시 검사한다. 어기면 응답이 거부되거나 판정이 강등된다.
- `instrumentId`, `snapshotId`, `marketType`은 입력 값을 그대로 복사한다. 다른 시장으로 바꾸지 않는다 (현물 작업은 spot, 무기한 작업은 perpetual).
- `priceBasis.sourceRef`와 `priceBasis.currency`는 입력 `priceBasis`의 값을 쓴다. 모든 가격은 이 소스와 통화 기준이다.
- `entry`: market이면 min·max를 둘 다 null로 둘 수 있다. limit이면 min = max, zone이면 min < max.
- 롱: `stopLoss < entry.min ≤ entry.max < 모든 targets`. 숏: `모든 targets < entry.min ≤ entry.max < stopLoss`.
- 진입(ENTER_LONG·ENTER_SHORT)이면 `stopLoss` 필수. spot에서는 ENTER_SHORT 불가, `leverage`는 null. perpetual의 `leverage`는 1~20 정수.
- 레버리지 L배의 증거금 소진 거리는 대략 `1/L − 0.5%`다. 손절 거리는 그 절반 이하로 둔다 (20배면 기준 가격 대비 약 2.25% 이내).
- 진입 제안의 `evidenceRefs`는 입력에서 확인되는 유효한 참조 2개 이상. 앞선 브리핑의 주장은 `brief:` 참조로 인용한다.
- `validForMinutes`: algorithm은 10080 이하, scalp·forced_direction은 240 이하.
- `confidence`: 0~100 정수. 적중 확률이 아니라 근거의 강도에 대한 자기 평가다.
- `rationale`은 400자 안팎, `invalidationConditions`는 판단이 틀렸다고 볼 구체 조건.
