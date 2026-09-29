"""P1-3-R12 독립 구현: 지표 기대값 생성기.

앱 코드(src/core/data/indicators.ts)를 보지 않고 P1 명세 3.1절 정의만으로 따로 구현했다.
언어(Python 3 표준 라이브러리)와 계산 방식(math.fsum, statistics.stdev, α 형태의 Wilder 식)을
일부러 다르게 해서, 같은 실수를 두 번 하지 않게 한다.

실행: python3 fixtures/indicators/gen_expected.py  →  expected.json 생성
입력: btc-perp-15m.json 의 rows 중 마지막 봉(기록 시점 미완성)을 뺀 완성 봉
"""
import json
import math
import os
import statistics

HERE = os.path.dirname(os.path.abspath(__file__))


def load():
    with open(os.path.join(HERE, "btc-perp-15m.json"), encoding="utf-8") as f:
        rows = json.load(f)["rows"]
    rows = rows[:-1]  # 기록 시점의 미완성 현재 봉 제외
    return [dict(o=r[2], h=r[3], l=r[4], c=r[5]) for r in rows]


def sma_last(xs, n):
    return math.fsum(xs[-n:]) / n


def ema_list(xs, n):
    """α = 2/(n+1), 시드는 처음 n개 평균. 반환 길이 = len(xs) - n + 1 (시드 시점부터)."""
    alpha = 2.0 / (n + 1)
    cur = math.fsum(xs[:n]) / n
    out = [cur]
    for x in xs[n:]:
        cur = cur + alpha * (x - cur)
        out.append(cur)
    return out


def wilder_alpha(xs, n):
    """Wilder 평활을 α = 1/n 형태로: avg = avg·(1−α) + x·α"""
    alpha = 1.0 / n
    avg = math.fsum(xs[:n]) / n
    for x in xs[n:]:
        avg = avg * (1 - alpha) + x * alpha
    return avg


def rsi(closes, n=14):
    diffs = [b - a for a, b in zip(closes, closes[1:])]
    up = wilder_alpha([max(d, 0.0) for d in diffs], n)
    down = wilder_alpha([max(-d, 0.0) for d in diffs], n)
    if up == 0 and down == 0:
        return 50.0
    if down == 0:
        return 100.0
    return 100.0 * up / (up + down)  # 100 − 100/(1+RS)와 같은 값, 다른 식


def macd(closes):
    e12 = ema_list(closes, 12)  # e12[k]는 closes[11 + k]까지
    e26 = ema_list(closes, 26)  # e26[k]는 closes[25 + k]까지
    line = [e12[k + 14] - e26[k] for k in range(len(e26))]
    sig = ema_list(line, 9)
    return dict(macd=line[-1], signal=sig[-1], hist=line[-1] - sig[-1])


def atr(bars, n=14):
    trs = []
    for prev, cur in zip(bars, bars[1:]):
        trs.append(max(cur["h"] - cur["l"], abs(cur["h"] - prev["c"]), abs(cur["l"] - prev["c"])))
    return wilder_alpha(trs, n)


def realized_vol(closes, period):
    window = closes[-(period + 1):]
    rets = [math.log(b / a) for a, b in zip(window, window[1:])]
    return statistics.stdev(rets)


def main():
    bars = load()
    closes = [b["c"] for b in bars]
    last20 = bars[-20:]
    expected = dict(
        method="fixtures/indicators/gen_expected.py (Python 표준 라이브러리 독립 구현, P1 명세 3.1 정의)",
        bars=len(bars),
        sma20=sma_last(closes, 20),
        sma50=sma_last(closes, 50),
        ema20=ema_list(closes, 20)[-1],
        rsi14=rsi(closes),
        macd=macd(closes),
        atr14=atr(bars),
        realizedVol32=realized_vol(closes, 32),
        recentHigh20=max(b["h"] for b in last20),
        recentLow20=min(b["l"] for b in last20),
    )
    with open(os.path.join(HERE, "expected.json"), "w", encoding="utf-8") as f:
        json.dump(expected, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(json.dumps(expected, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
