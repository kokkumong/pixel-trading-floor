## 브리핑 작성법
- `claims`는 3~5개. 각 주장은 `claimId`(c1, c2, …), 종류(`kind`), 한두 문장의 `text`, 근거 참조로 이루어진다.
  - `observation`: 입력에서 직접 확인한 사실. 근거 참조 1개 이상 필수. 수치는 입력 값을 그대로 옮긴다.
  - `interpretation`: 관찰에서 읽어낸 의미. 관련 관찰의 참조를 단다.
  - `assumption`: 확인되지 않은 전제. 참조가 없어도 된다.
- `counterScenario`: 내 판단과 반대로 갈 때의 시나리오 한두 문장.
- `changeTriggers`: 판단을 바꿀 구체적인 가격·지표 조건.
- `dataLimitations`: 빠졌거나 오래됐거나 믿기 어려운 데이터.
- `bias`: 내 영역의 근거만으로 본 방향 (BULLISH | BEARISH | NEUTRAL). 근거가 엇갈리면 NEUTRAL.
- `summary`: 말풍선에 띄울 한두 문장.
