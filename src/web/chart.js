// @ts-check
// 전광판 8비트 차트: 종가 선, MA20(금색)·MA50(파랑), 최근 20봉 고·저 점선, 날짜 라벨 (가이드 4-1).
// 낮은 해상도로 그린 뒤 CSS로 키워 픽셀 느낌을 낸다.

const SCALE = 2;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ interval: string; timezone: string; points: { t: number; close: number }[]; ma20: (number | null)[]; ma50: (number | null)[]; high20: number | null; low20: number | null } | null} chart
 */
export function drawChart(canvas, chart) {
  const w = Math.max(80, Math.floor(canvas.clientWidth / SCALE));
  const h = Math.max(40, Math.floor(canvas.clientHeight / SCALE));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#07080c';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1a1d27';
  for (let x = 0; x < w; x += 12) for (let y = 0; y < h; y += 12) ctx.fillRect(x, y, 1, 1);
  if (!chart || chart.points.length < 2) {
    ctx.fillStyle = '#5b6070';
    ctx.font = '8px monospace';
    ctx.fillText('NO DATA', 4, 12);
    return;
  }
  const pts = chart.points;
  const vals = [...pts.map((p) => p.close), ...chart.ma20.filter(isNum), ...chart.ma50.filter(isNum)];
  if (chart.high20 !== null) vals.push(chart.high20);
  if (chart.low20 !== null) vals.push(chart.low20);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const top = 4;
  const bottom = h - 10;
  const x = (/** @type {number} */ i) => Math.round(2 + (i * (w - 6)) / (pts.length - 1));
  const y = (/** @type {number} */ v) => Math.round(bottom - ((v - lo) / (hi - lo || 1)) * (bottom - top));

  const dashed = (/** @type {number} */ v, /** @type {string} */ color) => {
    ctx.fillStyle = color;
    for (let i = 2; i < w - 2; i += 4) ctx.fillRect(i, y(v), 2, 1);
  };
  if (chart.high20 !== null) dashed(chart.high20, '#5b6070');
  if (chart.low20 !== null) dashed(chart.low20, '#5b6070');

  const line = (/** @type {(number | null)[]} */ series, /** @type {string} */ color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    let started = false;
    series.forEach((v, i) => {
      if (!isNum(v)) return;
      const px = x(i) + 0.5;
      const py = y(v) + 0.5;
      if (started) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
      started = true;
    });
    ctx.stroke();
  };
  line(chart.ma50, '#4f8fe8');
  line(chart.ma20, '#e0b43c');
  const up = (pts.at(-1)?.close ?? 0) >= (pts[0]?.close ?? 0);
  line(pts.map((p) => p.close), up ? '#3ddc84' : '#ff4d4d');
  const last = pts.at(-1);
  if (last) {
    ctx.fillStyle = up ? '#3ddc84' : '#ff4d4d';
    ctx.fillRect(x(pts.length - 1) - 1, y(last.close) - 1, 3, 3);
  }

  ctx.fillStyle = '#5b6070';
  ctx.font = '6px monospace';
  const label = (/** @type {number} */ i) => {
    const p = pts[i];
    if (!p) return '';
    const d = new Date(p.t);
    const opts = /** @type {Intl.DateTimeFormatOptions} */ (chart.interval === '1d' ? { month: '2-digit', day: '2-digit', timeZone: chart.timezone } : { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: chart.timezone });
    return d.toLocaleString('en-GB', opts);
  };
  ctx.fillText(label(0), 2, h - 2);
  const mid = Math.floor(pts.length / 2);
  ctx.fillText(label(mid), x(mid) - 8, h - 2);
  const end = label(pts.length - 1);
  ctx.fillText(end, w - 4 - end.length * 4, h - 2);
}

/** @param {unknown} v @returns {v is number} */
function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}
