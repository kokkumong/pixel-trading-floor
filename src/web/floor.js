// @ts-check
// 픽셀 화면 (가이드 v1.2 4장). 서버 API: /api/status, /api/board, /api/analyze, /api/jobs/<id>/events(SSE)·snapshot·cancel.
// 모델 출력과 외부 텍스트는 textContent로만 넣는다 (P1-7-R11). HTML 문자열을 해석하는 API는 쓰지 않는다 (test/web/model.test.ts가 검사).
import { drawChart } from './chart.js';
import {
  bubbles, consoleEntries, DATA_FLOW, errorView, fmtChange, fmtClock, fmtPrice, FORCED_CONFIRM, floorPlan, initialMode, isDemo,
  MODES, multiRows, needsForcedConfirm, panelModel, planLabel, roleStatus, ROLES, stateLabel, WORLD_CLOCKS,
} from './model.js';
import { drawCharacter, repaint } from './sprites.js';

/** @typedef {import('./model.js').Mode} Mode */
/** @typedef {import('./model.js').ConsoleEntry} ConsoleEntry */

const BOARD_REFRESH_MS = 15_000;
const FORCED_KEY = 'floor.forcedConfirmed'; // 탭(세션)마다 한 번 (P0-5-R1). 모드 자체는 저장하지 않는다 (P0-5-R2)

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @param {string} tag @param {string} [cls] @param {string} [text] */
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const demo = isDemo(location.search);
const state = {
  /** @type {Mode} */ mode: initialMode(location.search),
  /** @type {any} */ status: null,
  /** @type {any} */ job: null,
  /** @type {any} */ snapshot: null,
  /** @type {string | null} */ jobId: null,
  /** @type {EventSource | null} */ events: null,
  /** @type {Set<string>} */ calling: new Set(),
  /** @type {{ key: string; entry: ConsoleEntry }[]} */ rendered: [],
  /** @type {{ at: string; text: string }[]} */ calls: [],
  /** @type {'all' | 'agent' | 'debate'} */ tab: 'all',
  /** @type {string | null} 같은 분석 요청의 재전송을 묶는 키 (P0-8-R4) */ pendingKey: null,
  /** @type {string} */ boardSymbol: '',
  /** @type {number | undefined} */ boardTimer: undefined,
  /** @type {any} */ board: null,
  /** @type {Map<string, { seat: HTMLElement; canvas: HTMLCanvasElement; bubble: HTMLElement }>} */ seats: new Map(),
  frame: 0,
};

// ---------- 공통 요청 ----------

/** 같은 출처 API만 부른다. 401이면 다시 여는 안내 (LAN·로컬 토큰) @param {string} path @param {RequestInit} [init] */
async function api(path, init) {
  const res = await fetch(path, init);
  if (res.status === 401) $('reauth').hidden = false;
  /** @type {any} */
  let body = null;
  try {
    body = await res.json();
  } catch { /* 본문 없음 */ }
  return { res, body };
}

// ---------- 초기화 ----------

async function init() {
  if (demo) {
    $('watermark').hidden = false;
    document.title = 'DEMO · PIXEL TRADING FLOOR';
  }
  renderClocks();
  setInterval(renderClocks, 1000);
  setInterval(tick, 500);
  bindControls();
  renderMode();
  renderRooms();

  const sym = /** @type {HTMLInputElement} */ ($('symbol'));
  sym.value = demo ? 'BTC' : 'BTC';
  void loadBoard(sym.value);

  const { res, body } = await api('/api/status');
  if (!res.ok || !body) {
    setStatus(`서버 상태를 읽지 못함 (${res.status})`);
    return;
  }
  state.status = body;
  if (body.lan) {
    $('lan').hidden = false;
    $('lan').textContent = `${body.lan.warning} · 접속 주소 만료 ${body.lan.expiresAt ? new Date(body.lan.expiresAt).toLocaleTimeString() : '—'}`;
  }
  if (!body.client.canAnalyze) {
    $('readonly').hidden = false;
    $('go').hidden = true;
  }
  $('diag-link').hidden = !body.client.local;
  renderMode();
  if (body.running.length > 0) watch(body.running[0]);
}

function bindControls() {
  for (const b of document.querySelectorAll('.mode')) {
    b.addEventListener('click', () => {
      const m = /** @type {Mode} */ (/** @type {HTMLElement} */ (b).dataset.mode);
      if (state.job && !state.job.terminal) return; // 실행 중에는 방 구성을 바꾸지 않는다
      state.mode = m;
      renderMode();
      renderRooms();
      renderJob();
    });
  }
  $('analyze').addEventListener('submit', (e) => {
    e.preventDefault();
    void analyze();
  });
  $('cancel').addEventListener('click', () => void cancel());
  const sym = /** @type {HTMLInputElement} */ ($('symbol'));
  /** @type {number | undefined} */
  let debounce;
  sym.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = window.setTimeout(() => void loadBoard(sym.value), 700);
  });
  for (const t of document.querySelectorAll('.tab')) {
    t.addEventListener('click', () => {
      state.tab = /** @type {'all'} */ (/** @type {HTMLElement} */ (t).dataset.tab);
      renderTabs();
      rebuildConsole(false);
    });
  }
  renderTabs();
  $('open-data-flow').addEventListener('click', () => openDataFlow());
  for (const b of document.querySelectorAll('[data-close]')) {
    b.addEventListener('click', () => /** @type {HTMLDialogElement} */ (b.closest('dialog')).close());
  }
  $('multi-toggle').addEventListener('click', () => {
    const body = $('multi-body');
    body.hidden = !body.hidden;
    $('multi-toggle').textContent = body.hidden ? '펼치기' : '접기';
  });
  $('toast').addEventListener('click', () => { $('toast').hidden = true; });
}

function renderMode() {
  for (const b of document.querySelectorAll('.mode')) {
    b.setAttribute('aria-checked', String(/** @type {HTMLElement} */ (b).dataset.mode === state.mode));
  }
  $('go').classList.toggle('forced', state.mode === 'forced_direction');
  $('plan').textContent = `${MODES[state.mode].label} · ${planLabel(state.mode, state.status?.plans)}`;
  if (demo && state.status && !state.status.demoModes.includes(state.mode)) $('plan').textContent += ' · 이 모드의 데모는 없습니다';
}

function renderTabs() {
  for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(/** @type {HTMLElement} */ (t).dataset.tab === state.tab));
}

function renderClocks() {
  const box = $('clocks');
  const now = new Date();
  if (box.childElementCount === 0) {
    for (const c of WORLD_CLOCKS) {
      const d = el('div', 'clock');
      d.append(el('div', 'tz', c.label), el('div', 't'));
      d.title = c.tz;
      box.append(d);
    }
  }
  WORLD_CLOCKS.forEach((c, i) => {
    const t = box.children[i]?.querySelector('.t');
    if (t) t.textContent = fmtClock(now, c.tz);
  });
}

function setStatus(/** @type {string} */ text) {
  $('status').textContent = text;
}

// ---------- 전광판 ----------

/** @param {string} raw */
async function loadBoard(raw) {
  const symbol = raw.trim();
  clearTimeout(state.boardTimer);
  if (!symbol) return;
  state.boardSymbol = symbol;
  const { res, body } = await api(`/api/board?symbol=${encodeURIComponent(symbol)}${demo ? '&demo=1' : ''}`);
  if (state.boardSymbol !== symbol) return; // 그 사이 입력이 바뀜
  const resolved = $('resolved');
  if (!res.ok || !body || body.error) {
    resolved.classList.add('err');
    const cands = (body?.candidates ?? []).map((/** @type {any} */ c) => c.displayName).join(', ');
    resolved.textContent = `${body?.message ?? `시세를 읽지 못함 (${res.status})`}${cands ? ` · 혹시: ${cands}` : ''}`;
    renderBoard(null);
    return;
  }
  resolved.classList.remove('err');
  resolved.textContent = `분석 대상: ${body.description}`; // P1-2-R4
  state.board = body;
  renderBoard(body);
  if (!demo) state.boardTimer = window.setTimeout(() => void loadBoard(symbol), BOARD_REFRESH_MS);
}

/** @param {any} b */
function renderBoard(b) {
  $('q-name').textContent = b ? b.displayName : '—';
  $('q-price').textContent = b?.price ? fmtPrice(b.price.value, b.price.currency) : '—';
  const ch = $('q-change');
  const r = b?.price?.changeRatio;
  ch.textContent = r === null || r === undefined ? '' : fmtChange(r);
  ch.className = `q-change ${r > 0 ? 'up' : r < 0 ? 'down' : ''}`;
  const mk = $('q-market');
  mk.textContent = b ? `${b.market.state === 'OPEN' ? '■ MARKET OPEN' : '■ MARKET CLOSED'} · ${b.market.label}` : '';
  mk.className = `market ${b?.market.state === 'OPEN' ? '' : 'closed'}`;
  mk.hidden = !b;
  $('q-time').textContent = b ? `${b.demo ? '녹화 시각' : '조회'} ${new Date(b.builtAt).toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})${b.price?.observedAt ? '' : ' · 시세 시각 미확인'}` : '';
  drawChart(/** @type {HTMLCanvasElement} */ ($('chart')), b?.chart ?? null);

  const rows = multiRows(b);
  $('multi').hidden = rows.length === 0;
  if (rows.length > 0) {
    $('multi-basis').textContent = `${b.displayName} · USDT 무기한 기준`;
    $('multi-time').textContent = `갱신 ${new Date(b.builtAt).toLocaleTimeString()}`;
    const body = $('multi-body');
    body.replaceChildren(...rows.map((row) => {
      const d = el('div', `multi-row ${row.tone ?? ''}`);
      d.append(el('span', 'l', row.label), el('span', 'v', row.value), el('span', 'n', row.note));
      d.title = row.note;
      return d;
    }));
  }
}

// ---------- 사무실 ----------

function renderRooms() {
  state.seats.clear();
  for (const room of floorPlan(state.mode)) {
    const sec = $(`room-${room.id}`);
    /** @type {HTMLElement} */ (sec.querySelector('.room-title')).textContent = room.title;
    const seats = /** @type {HTMLElement} */ (sec.querySelector('.seats'));
    seats.replaceChildren(...room.seats.map((s) => {
      const seat = el('div', `seat ${s.active ? '' : 'off'}`);
      seat.dataset.role = s.role;
      const bubble = el('button', 'bubble');
      bubble.setAttribute('type', 'button');
      bubble.addEventListener('click', () => openBriefing(s.role));
      const canvas = drawCharacter(s.role);
      seat.append(bubble, canvas, el('div', 'name', s.role), el('div', 'role-tag', ROLES[s.role].title));
      state.seats.set(s.role, { seat, canvas, bubble });
      return seat;
    }));
  }
}

function renderSeats() {
  const text = bubbles(state.job);
  const st = roleStatus(state.job, state.calling);
  for (const [role, s] of state.seats) {
    const t = /** @type {Record<string, string>} */ (text)[role] ?? '';
    if (s.bubble.textContent !== t) s.bubble.textContent = t;
    s.seat.classList.toggle('thinking', /** @type {Record<string, string>} */ (st)[role] === 'thinking');
    s.seat.classList.toggle('done', /** @type {Record<string, string>} */ (st)[role] === 'done');
  }
}

function tick() {
  state.frame ^= 1;
  for (const r of state.calling) {
    const s = state.seats.get(r);
    if (s) repaint(s.canvas, r, state.frame);
  }
}

// ---------- 분석 실행 ----------

async function analyze() {
  const go = /** @type {HTMLButtonElement} */ ($('go'));
  if (go.disabled) return;
  if (needsForcedConfirm(state.mode, sessionFlag())) {
    if (!(await confirmForced())) return;
  }
  go.disabled = true;
  state.pendingKey ??= crypto.randomUUID();
  const body = { symbol: /** @type {HTMLInputElement} */ ($('symbol')).value, mode: state.mode, idempotencyKey: state.pendingKey, demo };
  try {
    const { res, body: r } = await api('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.status === 409 && r?.running) {
      setStatus(`${r.message}: ${r.running.symbolInput} ${MODES[/** @type {Mode} */ (r.running.mode)]?.label ?? r.running.mode}`);
      watch(r.running.jobId);
    } else if (!res.ok || !r) {
      showStartError(r?.error ?? `HTTP ${res.status}`, r?.message ?? '요청 실패', r?.hint ?? null);
    } else {
      watch(r.jobId);
    }
  } catch (err) {
    setStatus(`요청 실패: ${String(err)}`);
  } finally {
    state.pendingKey = null;
    go.disabled = false;
  }
}

function sessionFlag() {
  try {
    return sessionStorage.getItem(FORCED_KEY) === '1';
  } catch {
    return false;
  }
}

/** @returns {Promise<boolean>} */
function confirmForced() {
  const dlg = /** @type {HTMLDialogElement} */ ($('forced-dialog'));
  $('forced-title').textContent = FORCED_CONFIRM.title;
  $('forced-body').replaceChildren(...FORCED_CONFIRM.body.map((t) => el('p', '', t)));
  $('forced-accept').textContent = FORCED_CONFIRM.accept;
  $('forced-cancel').textContent = FORCED_CONFIRM.cancel;
  return new Promise((resolve) => {
    const done = (/** @type {boolean} */ ok) => {
      $('forced-accept').removeEventListener('click', accept);
      $('forced-cancel').removeEventListener('click', reject);
      dlg.removeEventListener('cancel', reject);
      dlg.close();
      resolve(ok);
    };
    const accept = () => {
      try { sessionStorage.setItem(FORCED_KEY, '1'); } catch { /* 저장 불가면 다음에 다시 묻는다 */ }
      done(true);
    };
    const reject = () => done(false);
    $('forced-accept').addEventListener('click', accept);
    $('forced-cancel').addEventListener('click', reject);
    dlg.addEventListener('cancel', reject);
    dlg.showModal();
  });
}

/** 분석을 시작하지 못함 (작업 없음): 콘솔에 안내만 @param {string} code @param {string} message @param {string | null} hint */
function showStartError(code, message, hint) {
  setStatus(`${code}: ${message}`);
  const e = el('div', 'entry error');
  e.append(el('div', 'h', `분석을 시작하지 못함 · ${code}`), el('p', '', message));
  if (hint) e.append(diagLink(hint));
  $('log').append(e);
  $('log').scrollTop = $('log').scrollHeight;
}

/** 서버가 준 진단 경로만 링크로 만든다 @param {string} hint */
function diagLink(hint) {
  const p = el('p');
  if (hint === '/diagnostics') {
    const a = /** @type {HTMLAnchorElement} */ (el('a', '', '진단 페이지 열기'));
    a.href = '/diagnostics';
    p.append(a);
  }
  return p;
}

/** @param {string} id */
function watch(id) {
  state.events?.close();
  state.jobId = id;
  state.job = null;
  state.snapshot = null;
  state.calling.clear();
  state.calls = [];
  state.rendered = [];
  $('log').replaceChildren();
  $('toast').hidden = true;
  $('cancel').hidden = !(state.status?.client?.canAnalyze);
  const es = new EventSource(`/api/jobs/${id}/events`);
  state.events = es;
  es.addEventListener('job', (ev) => {
    const { job } = JSON.parse(/** @type {MessageEvent} */ (ev).data);
    onJob(job);
  });
  es.addEventListener('call', (ev) => {
    const c = JSON.parse(/** @type {MessageEvent} */ (ev).data);
    if (c.phase === 'start') state.calling.add(c.role);
    else state.calling.delete(c.role);
    const t = new Date().toLocaleTimeString();
    state.calls.push({ at: t, text: c.phase === 'start' ? `→ ${c.role} 호출` : `← ${c.role} ${c.ok ? `완료 ${(c.durationMs / 1000).toFixed(1)}초` : c.code}` });
    renderSeats();
    renderFooter();
  });
  es.addEventListener('end', () => {
    es.close();
    state.calling.clear();
    $('cancel').hidden = true;
    renderSeats();
    if (state.job) void refreshFinal(state.job.jobId);
  });
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) setStatus('진행 연결이 끊겼습니다. 새로 고침하면 이어서 볼 수 있습니다');
  };
}

/** @param {any} job */
function onJob(job) {
  const first = state.job === null;
  state.job = job;
  if (first && job.mode !== state.mode) {
    state.mode = job.mode;
    renderMode();
    renderRooms();
  }
  if (!state.snapshot && job.snapshot) void loadSnapshot(job.jobId);
  renderJob();
}

/** 끝난 뒤 최종 보기를 한 번 더 읽는다 (리포트 링크·만료 시각) @param {string} id */
async function refreshFinal(id) {
  const { res, body } = await api(`/api/jobs/${id}`);
  if (res.ok && body && state.jobId === id) {
    state.job = body;
    renderJob();
  }
}

/** @param {string} id */
async function loadSnapshot(id) {
  const { res, body } = await api(`/api/jobs/${id}/snapshot`);
  if (res.ok && body && state.jobId === id) {
    state.snapshot = body;
    renderConsole();
  }
}

async function cancel() {
  if (!state.jobId) return;
  const { res } = await api(`/api/jobs/${state.jobId}/cancel`, { method: 'POST' });
  if (!res.ok) setStatus(`취소 실패 (${res.status})`);
  else setStatus('취소하는 중…');
}

function renderJob() {
  const job = state.job;
  renderSeats();
  renderPanel();
  renderConsole();
  renderFooter();
  if (!job) return;
  const used = job.usage.modelCallCount;
  const plan = job.plannedModelCallRange;
  setStatus(`${job.symbolInput} · ${MODES[/** @type {Mode} */ (job.mode)].label} · ${stateLabel(job.state, job.mode)} · 호출 ${used}회 (계획 ${plan.min === plan.max ? plan.min : `${plan.min}~${plan.max}`})${job.demo ? ' · DEMO' : ''}`);
  if (job.reportUrl && job.terminal) {
    const t = /** @type {HTMLAnchorElement} */ ($('toast'));
    t.href = job.reportUrl;
    t.target = '_blank';
    t.rel = 'noopener noreferrer';
    t.textContent = `리포트 저장됨 (클릭해서 열기) · ${job.symbolInput} ${MODES[/** @type {Mode} */ (job.mode)].label}`;
    t.hidden = false;
  }
}

function renderFooter() {
  const job = state.job;
  $('console-state').textContent = job ? stateLabel(job.state, job.mode) : '대기 중';
  $('console-count').textContent = job ? `호출 ${job.usage.modelCallCount}회${job.usage.retryCallCount ? ` · 재시도 ${job.usage.retryCallCount}` : ''}` : '';
}

function renderPanel() {
  const p = panelModel(state.job, Date.now());
  const panel = $('panel');
  panel.hidden = !p;
  if (!p) return;
  panel.className = `panel tone-${p.tone}`;
  $('panel-badges').replaceChildren(...p.badges.map((b) => el('span', `badge ${b === '강제 방향 시뮬레이션' ? 'sim' : b.startsWith('DEMO') ? 'demo' : b === '규칙 차단' ? 'block' : ''}`, b)));
  $('panel-title').textContent = `최종 판정 · ${p.title}`;
  $('panel-notes').replaceChildren(...p.notes.map((n, i) => el('div', i === 0 && p.simulation ? 'first-sim' : '', n)));
  $('panel-headline').textContent = p.headline;
  const conf = $('panel-conf');
  conf.replaceChildren();
  if (p.confidence) conf.append('확신도 ', el('b', '', p.confidence), ` · ${p.confidenceNote}`);
  $('panel-rows').replaceChildren(...p.rows.flatMap((r) => [el('dt', '', r.label), el('dd', '', r.value)]));
  const risk = $('panel-risk');
  risk.replaceChildren();
  if (p.risk) risk.append(el('div', '', `${p.risk.label}: ${p.risk.value}`), el('div', '', `가정: ${p.risk.assumptions.join(' · ')}`));
  $('panel-violations').replaceChildren(...p.violations.map((v) => el('div', '', v)));
  $('panel-rationale').textContent = p.rationale ?? '';
  const rep = /** @type {HTMLAnchorElement} */ ($('panel-report'));
  rep.hidden = !state.job?.reportUrl;
  if (state.job?.reportUrl) {
    rep.href = state.job.reportUrl;
    rep.target = '_blank';
    rep.rel = 'noopener noreferrer';
  }
}

// ---------- 콘솔 ----------

/** @param {ConsoleEntry} e */
const entryKey = (e) => `${e.kind}|${e.role ?? ''}|${e.title}|${e.lines.length}`;

/** 새로 생긴 항목만 이어 붙이고 타이핑 효과를 준다. 앞부분이 바뀌면 전체를 다시 그린다 */
function renderConsole() {
  const entries = consoleEntries(state.job, state.snapshot);
  const keys = entries.map(entryKey);
  const same = state.rendered.every((r, i) => keys[i] === r.key);
  if (!same) {
    state.rendered = entries.map((entry, i) => ({ key: keys[i] ?? '', entry }));
    rebuildConsole(false);
    return;
  }
  const fresh = entries.slice(state.rendered.length);
  for (const [i, entry] of fresh.entries()) {
    state.rendered.push({ key: keys[state.rendered.length] ?? '', entry });
    if (visible(entry)) appendEntry(entry, i === fresh.length - 1);
  }
}

/** @param {boolean} typing */
function rebuildConsole(typing) {
  $('log').replaceChildren();
  for (const r of state.rendered) if (visible(r.entry)) appendEntry(r.entry, typing);
}

/** @param {ConsoleEntry} e */
function visible(e) {
  if (state.tab === 'all') return true;
  if (state.tab === 'debate') return e.tab === 'debate';
  return e.tab === 'agent';
}

/** @param {ConsoleEntry} e @param {boolean} typing */
function appendEntry(e, typing) {
  const log = $('log');
  const box = el('div', `entry ${e.kind} ${e.role ?? ''}`);
  const h = el('div', 'h');
  if (e.role) h.append(el('span', 'tag', e.role));
  h.append(e.role ? e.title.replace(`${e.role} · `, '') : e.title);
  box.append(h);
  const paras = e.lines.map((line) => el('p', '', typing ? '' : line));
  box.append(...paras);
  if (e.kind === 'error') {
    const err = errorView(state.job);
    if (err?.hint) box.append(diagLink(err.hint));
  }
  if (e.role) {
    box.style.cursor = 'pointer';
    box.title = '눌러서 크게 보기';
    box.addEventListener('click', () => openBriefing(/** @type {string} */ (e.role)));
  }
  log.append(box);
  const stick = () => { log.scrollTop = log.scrollHeight; };
  stick();
  if (typing) typeLines(paras, e.lines, stick);
}

/** 타이핑 연출: 한 번에 여러 글자씩 (긴 브리핑도 몇 초 안에) @param {HTMLElement[]} paras @param {string[]} lines @param {() => void} stick */
function typeLines(paras, lines, stick) {
  let p = 0;
  let i = 0;
  const step = () => {
    const para = paras[p];
    const line = lines[p];
    if (!para || line === undefined) return;
    i = Math.min(line.length, i + 12);
    para.textContent = line.slice(0, i);
    para.classList.toggle('caret', i < line.length);
    stick();
    if (i >= line.length) {
      para.classList.remove('caret');
      p++;
      i = 0;
    }
    if (p < paras.length) setTimeout(step, 16);
  };
  step();
}

// ---------- 대화상자 ----------

function openDataFlow() {
  $('flow-title').textContent = DATA_FLOW.title;
  $('flow-body').replaceChildren(...DATA_FLOW.items.map((t) => el('li', '', t)));
  /** @type {HTMLDialogElement} */ ($('flow-dialog')).showModal();
}

/** 말풍선 클릭 → 그 에이전트의 브리핑 전문 (가이드 4-2) @param {string} role */
function openBriefing(role) {
  const entries = consoleEntries(state.job, state.snapshot).filter((e) => e.role === role);
  $('brief-title').textContent = `${role} · ${ROLES[/** @type {keyof typeof ROLES} */ (role)]?.title ?? ''}`;
  const body = $('brief-body');
  if (entries.length === 0) body.replaceChildren(el('p', 'muted', '아직 이 에이전트의 발언이 없습니다.'));
  else body.replaceChildren(...entries.flatMap((e) => [el('p', 'gold', e.title), ...e.lines.map((l) => el('p', '', l))]));
  /** @type {HTMLDialogElement} */ ($('brief-dialog')).showModal();
}

void init();
