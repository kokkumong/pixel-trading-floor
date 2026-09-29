// @ts-check
// Phase 6 임시 화면: 분석 실행(POST /api/analyze) → 진행 이벤트(SSE) → 결과·리포트 링크.
// 모델 출력과 외부 텍스트는 textContent로만 넣는다 (P1-7-R11). 픽셀 UI는 Phase 7에서 바꾼다.

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const demo = new URLSearchParams(location.search).get('demo') === '1';
/** @type {string | null} 같은 분석 요청의 재전송을 묶는 키 (P0-8-R4) */
let pendingKey = null;
/** @type {string | null} */
let jobId = null;
/** @type {EventSource | null} */
let events = null;

/** @param {string} line */
function log(line) {
  const el = $('log');
  el.textContent += `${line}\n`;
  el.scrollTop = el.scrollHeight;
}

/** @param {string} text */
function status(text) {
  $('status').textContent = text;
}

async function init() {
  if (demo) {
    $('watermark').hidden = false;
    document.title = 'DEMO · PIXEL TRADING FLOOR';
  }
  const res = await fetch('/api/status');
  if (!res.ok) return status(`서버 상태를 읽지 못함 (${res.status})`);
  const s = await res.json();
  if (s.lan) {
    const lan = $('lan');
    lan.hidden = false;
    lan.textContent = `${s.lan.warning} · 접속 주소 만료 ${new Date(s.lan.expiresAt).toLocaleTimeString()}`;
  }
  if (!s.client.canAnalyze) {
    $('readonly').hidden = false;
    /** @type {HTMLButtonElement} */ ($('go')).disabled = true;
  }
  if (!s.client.local) $('diag-link').hidden = true;
  if (s.running.length > 0) watch(s.running[0]);
}

/** @param {SubmitEvent} e */
async function analyze(e) {
  e.preventDefault();
  const go = /** @type {HTMLButtonElement} */ ($('go'));
  if (go.disabled) return;
  go.disabled = true;
  pendingKey ??= crypto.randomUUID();
  const body = {
    symbol: /** @type {HTMLInputElement} */ ($('symbol')).value,
    mode: /** @type {HTMLSelectElement} */ ($('mode')).value,
    idempotencyKey: pendingKey,
    demo,
  };
  try {
    const res = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const r = await res.json();
    if (res.status === 409 && r.running) {
      status(`${r.message}: ${r.running.symbolInput} ${r.running.mode}`);
      watch(r.running.jobId);
    } else if (!res.ok) {
      status(`${r.error}: ${r.message}`);
      if (r.hint) log(`진단 페이지: ${r.hint}`);
    } else {
      watch(r.jobId);
    }
  } catch (err) {
    status(`요청 실패: ${String(err)}`);
  } finally {
    pendingKey = null;
    go.disabled = false;
  }
}

/** @param {string} id */
function watch(id) {
  events?.close();
  jobId = id;
  $('log').textContent = '';
  $('report').hidden = true;
  /** @type {HTMLButtonElement} */ ($('cancel')).disabled = false;
  events = new EventSource(`/api/jobs/${id}/events`);
  /** @type {string} */
  let last = '';
  events.addEventListener('job', (ev) => {
    const { job } = JSON.parse(/** @type {MessageEvent} */ (ev).data);
    if (job.state !== last) {
      last = job.state;
      log(`[${job.state}] ${job.instrumentId ?? job.symbolInput} · ${job.mode}${job.demo ? ' · DEMO' : ''}`);
    }
    status(`${job.state} · 호출 ${job.usage.modelCallCount}회 (계획 ${job.plannedModelCallRange.min}~${job.plannedModelCallRange.max})`);
    if (job.error) log(`오류 ${job.error.code}: ${job.error.message}${job.error.hint ? ` → ${job.error.hint}` : ''}`);
    if (job.panel) log(`판정: ${job.panel.title} · ${job.panel.headline}${job.panel.badges.length ? ` [${job.panel.badges.join('] [')}]` : ''}`);
    if (job.reportUrl) {
      $('report').hidden = false;
      /** @type {HTMLAnchorElement} */ ($('report-link')).href = job.reportUrl;
    }
  });
  events.addEventListener('call', (ev) => {
    const c = JSON.parse(/** @type {MessageEvent} */ (ev).data);
    log(c.phase === 'start' ? `→ ${c.role}` : `← ${c.role} ${c.ok ? `ok ${(c.durationMs / 1000).toFixed(1)}초` : c.code}`);
  });
  events.addEventListener('end', () => {
    events?.close();
    /** @type {HTMLButtonElement} */ ($('cancel')).disabled = true;
  });
}

async function cancel() {
  if (!jobId) return;
  const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
  if (!res.ok) status(`취소 실패 (${res.status})`);
}

$('analyze').addEventListener('submit', (e) => void analyze(/** @type {SubmitEvent} */ (e)));
$('cancel').addEventListener('click', () => void cancel());
void init();
