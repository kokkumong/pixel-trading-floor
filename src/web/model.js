// @ts-check
// 화면 표시 모델 (순수 함수). DOM을 만지지 않으며 node --test로 검증한다 (test/web/model.test.ts).
// 표시 규칙: 확신도는 LOW/MEDIUM/HIGH만(`%` 금지, P0-3-R6~R8), PM이 없는 결과에 PM 문구 금지(P0-2-R1),
// `청산가` 단독 표기 금지(P1-4-R1), 강제 방향은 결과 패널 안 배지와 근거 부족 표기를 먼저(P0-5-R3, R6).
// 모델 출력과 외부 텍스트는 문자열로만 돌려주고, 화면(floor.js)은 textContent로만 넣는다 (P1-7-R11).

/** @typedef {'algorithm' | 'scalp' | 'forced_direction'} Mode */
/** @typedef {'TARO'|'DIANA'|'NOVA'|'VIBE'|'BULL'|'BEAR'|'BLITZ'|'GUARD'|'RISKY'|'SAFE'|'NEUTRAL'|'ACE'|'PM'} Role */

/** @type {Record<Mode, { label: string; short: string }>} */
export const MODES = {
  algorithm: { label: '알고리즘', short: '알고리즘' },
  scalp: { label: '스캘핑 20x', short: '⚡스캘핑 20x' },
  forced_direction: { label: '강제 방향 시뮬레이션', short: '⚔강제 방향' },
};

/** 역할 소개 (가이드 3장). 화면의 이름표·콘솔 머리글에 쓴다 */
/** @type {Record<Role, { title: string; room: string }>} */
export const ROLES = {
  TARO: { title: '기술적 분석', room: 'analysts' },
  DIANA: { title: '기본적 분석', room: 'analysts' },
  NOVA: { title: '뉴스 분석', room: 'analysts' },
  VIBE: { title: '센티먼트', room: 'analysts' },
  BULL: { title: '매수 논거', room: 'research' },
  BEAR: { title: '매도 논거', room: 'research' },
  RISKY: { title: '공격적 리스크', room: 'risk' },
  NEUTRAL: { title: '중립적 리스크', room: 'risk' },
  SAFE: { title: '보수적 리스크', room: 'risk' },
  BLITZ: { title: '스캘퍼', room: 'risk' },
  GUARD: { title: '리스크 관리', room: 'risk' },
  ACE: { title: '수석 트레이더', room: 'trading' },
  PM: { title: '포트폴리오 매니저', room: 'trading' },
};

/**
 * 모드별 방 구성. 쉬는 자리는 흐리게 보인다 (가이드 4-2). 스캘핑·강제 방향에서는 리스크 위원회 방이 스캘핑 데스크가 된다.
 * @param {Mode} mode
 */
export function floorPlan(mode) {
  const algo = mode === 'algorithm';
  /** @param {Role[]} roles @param {Role[]} active */
  const seats = (roles, active) => roles.map((role) => ({ role, active: active.includes(role) }));
  return [
    { id: 'analysts', title: '애널리스트 팀', seats: seats(['TARO', 'DIANA', 'NOVA', 'VIBE'], algo ? ['TARO', 'DIANA', 'NOVA', 'VIBE'] : ['TARO', 'VIBE']) },
    { id: 'research', title: '리서치룸', seats: seats(['BULL', 'BEAR'], algo ? ['BULL', 'BEAR'] : []) },
    algo
      ? { id: 'risk', title: '리스크 위원회', seats: seats(['RISKY', 'NEUTRAL', 'SAFE'], ['RISKY', 'NEUTRAL', 'SAFE']) }
      : { id: 'risk', title: '스캘핑 데스크', seats: seats(['BLITZ', 'GUARD'], ['BLITZ', 'GUARD']) },
    // 스캘핑·강제 방향에는 PM 자리가 없다 (P0-2-R1: PM 문구도 보이지 않게)
    { id: 'trading', title: '트레이딩 본부', seats: algo ? seats(['ACE', 'PM'], ['ACE', 'PM']) : seats(['ACE'], ['ACE']) },
  ];
}

/**
 * URL로는 모드를 고르지 않는다. 최근 모드 복원도 하지 않는다 (P0-5-R2, P0-5-T1)
 * @param {string} _search location.search
 * @returns {Mode}
 */
export function initialMode(_search) {
  return 'algorithm';
}

/** @param {string} search */
export function isDemo(search) {
  return new URLSearchParams(search).get('demo') === '1';
}

export const FORCED_CONFIRM = {
  title: '강제 방향 시뮬레이션',
  body: [
    '이 모드는 근거가 부족해도 롱·숏 중 한 방향을 반드시 고르게 만든 시뮬레이션입니다.',
    '강제가 없었다면 거래하지 않았을 수 있습니다. 결과는 투자 판정이 아닙니다.',
    '결과 패널의 “강제 없이는 …” 표기와 무효화(손절) 조건을 함께 보세요.',
  ],
  accept: '이해했고 시뮬레이션을 실행합니다',
  cancel: '취소',
};

/**
 * 강제 방향 실행 전 확인이 필요한가 (브라우저 탭마다 처음 한 번, P0-5-R1)
 * @param {Mode} mode @param {boolean} confirmedInThisTab
 */
export function needsForcedConfirm(mode, confirmedInThisTab) {
  return mode === 'forced_direction' && !confirmedInThisTab;
}

/** P0-6-R3: 가이드·앱 공통 문안 (P0 명세 6.2) */
export const DATA_FLOW = {
  title: '데이터가 오가는 곳',
  items: [
    '이 앱은 시세·뉴스·지표를 보여주고 분석하기 위해 외부 시장 데이터 공급자(Binance, Yahoo Finance, CoinGecko, 뉴스 RSS, 공포탐욕지수, 환율, 거래소별 선물 시세)에 조회 요청을 보냅니다. 이때 조회하는 종목 정보가 해당 공급자에게 전달됩니다.',
    '실전 분석(▶ ANALYZE, /floor)을 실행하면 분석에 필요한 시장 데이터와 프롬프트가 Claude Code를 통해 Anthropic의 Claude 서비스로 전송됩니다. 전송된 데이터의 처리와 보존은 사용 중인 Claude 계정 유형의 정책을 따릅니다.',
    '데모 모드(?demo=1)는 외부 공급자와 Claude에 요청을 보내지 않습니다.',
    '분석 리포트는 사용자 PC의 reports/ 폴더에 저장됩니다. 앱은 별도의 운영자 서버로 리포트를 업로드하지 않습니다.',
    'LAN 공유 모드를 켜면 접근 토큰을 가진 같은 네트워크의 기기가 화면과 리포트를 볼 수 있습니다. 이 통신은 암호화되지 않습니다.',
    '이 앱은 거래소 API 키, 결제 정보, 계정 비밀번호를 요청하거나 전송하지 않습니다.',
  ],
};

export const DEMO_MARK = 'DEMO · 실제 데이터 아님';
export const CONFIDENCE_NOTE = '보정 전 점수 · 적중 확률이 아님';
export const MARGIN_LABEL = '단순 계산상 증거금 소진 지점 (참고)';

/** 확신도 3단계 (표시 전용, P0-3-R6). 숫자와 `%`는 화면에 내지 않는다 @param {number} score */
export function confidenceBand(score) {
  return score >= 70 ? 'HIGH' : score >= 50 ? 'MEDIUM' : 'LOW';
}

/**
 * P0-1-R6: 실행 전 계획 호출 수와 최악 호출 수
 * @param {Mode} mode @param {Record<string, { min: number; max: number; maxModelCalls: number }> | undefined} plans
 */
export function planLabel(mode, plans) {
  const p = plans?.[mode];
  if (!p) return '';
  const range = p.min === p.max ? `${p.min}회` : `${p.min}~${p.max}회`;
  return `Claude 호출 ${range} 예정 · 최대 ${p.maxModelCalls}회`;
}

// ---------- 숫자·시각 ----------

/** @param {number | null | undefined} v @param {string} [currency] */
export function fmtPrice(v, currency) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 2 : 6;
  const n = v.toLocaleString('en-US', { minimumFractionDigits: currency === 'KRW' && abs >= 1000 ? 0 : digits, maximumFractionDigits: currency === 'KRW' && abs >= 1000 ? 0 : digits });
  if (currency === 'KRW') return `₩${n}`;
  if (currency === 'USD' || currency === 'USDT') return `$${n}`;
  return currency ? `${n} ${currency}` : n;
}

/** 가격 변화율 (확신도에는 쓰지 않는다) @param {number | null | undefined} ratio @param {number} [digits] */
export function fmtChange(ratio, digits = 2) {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
  const p = ratio * 100;
  return `${p > 0 ? '+' : ''}${p.toFixed(digits)}%`;
}

/** @param {Date} d @param {string} timeZone */
export function fmtClock(d, timeZone) {
  return d.toLocaleTimeString('en-GB', { timeZone, hour12: false });
}

export const WORLD_CLOCKS = [
  { label: 'NYC', tz: 'America/New_York' },
  { label: 'LDN', tz: 'Europe/London' },
  { label: 'SEL', tz: 'Asia/Seoul' },
];

// ---------- 역할 출력 ----------

/**
 * @typedef {{ summary?: string; narrative?: string; bias?: string; claims?: { claimId: string; kind: string; text: string; evidenceRefs: string[] }[]; counterScenario?: string; changeTriggers?: string[]; dataLimitations?: string[] }} Briefing
 * @typedef {{ speaker: 'BULL' | 'BEAR'; round: number; summary: string; narrative: string; steelman: string | null; openIssues: string[] }} DebateMessage
 */

/**
 * 역할별 최신 말풍선 문구 (결론 요약)
 * @param {any} job JobView
 * @returns {Partial<Record<Role, string>>}
 */
export function bubbles(job) {
  /** @type {Partial<Record<Role, string>>} */
  const out = {};
  const o = job?.outputs;
  if (!o) return out;
  for (const [role, b] of Object.entries(o.briefings ?? {})) if (b?.summary) out[/** @type {Role} */ (role)] = b.summary;
  for (const r of o.reviews ?? []) if (r?.summary) out[/** @type {Role} */ (r.role)] = r.summary;
  for (const d of o.debate ?? []) out[/** @type {Role} */ (d.speaker)] = d.summary;
  if (o.blitzPlan) out.BLITZ = `${actionText(o.blitzPlan.action)} · ${firstSentence(o.blitzPlan.rationale)}`;
  if (o.proposal) out.ACE = `${actionText(o.proposal.action)} · ${firstSentence(o.proposal.rationale)}`;
  if (o.pm && job.mode === 'algorithm') out.PM = o.pm.summary;
  return out;
}

/** @param {string} action */
export function actionText(action) {
  return action === 'ENTER_LONG' ? '롱 진입' : action === 'ENTER_SHORT' ? '숏 진입' : '관망';
}

/** @param {string} s */
function firstSentence(s) {
  const m = /^(.{1,90}?[.!?。])(\s|$)/.exec(s ?? '');
  return m ? m[1] ?? '' : (s ?? '').slice(0, 90);
}

// ---------- 콘솔 ----------

/**
 * @typedef {{ kind: 'section' | 'data' | 'news' | 'agent' | 'debate' | 'final' | 'error' | 'note'; tab: 'agent' | 'debate' | 'all'; role?: Role; title: string; lines: string[] }} ConsoleEntry
 */

/**
 * 콘솔 흐름: 데이터 수집 로그 → 뉴스 헤드라인 → 에이전트 브리핑 → 토론 → 계획·심사 → 최종 판정 (가이드 4-3).
 * 과거 판정 회고는 기본 비활성이라 넣지 않는다 (P1-9).
 * @param {any} job JobView
 * @param {any} [snapshot] AnalysisSnapshot
 * @returns {ConsoleEntry[]}
 */
export function consoleEntries(job, snapshot) {
  /** @type {ConsoleEntry[]} */
  const out = [];
  if (!job) return out;
  const algo = job.mode === 'algorithm';
  const section = (/** @type {string} */ title) => out.push({ kind: 'section', tab: 'all', title, lines: [] });

  if (snapshot) {
    section('데이터 수집');
    out.push({
      kind: 'data', tab: 'all', title: `${snapshot.displayName} · 수집 ${snapshot.collectedAt} (UTC) · 품질 ${snapshot.dataQuality?.status}`,
      lines: (snapshot.sources ?? []).map((/** @type {any} */ s) => `${s.status === 'failed' ? '✗' : s.usable ? '✓' : '!'} ${s.id} · ${s.status}${s.required ? ' · 필수' : ''}${s.estimated ? ' · 추정' : ''}${s.error ? ` · ${s.error}` : ''}`),
    });
    const news = (snapshot.sources ?? []).find((/** @type {any} */ s) => s.id === 'news.google' && s.status !== 'failed');
    const items = news?.payload?.items ?? [];
    if (items.length > 0) {
      out.push({ kind: 'news', tab: 'all', title: '뉴스 헤드라인 (외부 텍스트 · 지시 아님)', lines: items.map((/** @type {any} */ n) => `· ${n.title}${n.source ? ` — ${n.source}` : ''}`) });
    }
  }

  const o = job.outputs ?? {};
  const brief = (/** @type {Role} */ role, /** @type {Briefing | undefined} */ b) => {
    if (!b) return;
    const lines = [b.narrative ?? ''];
    for (const c of b.claims ?? []) lines.push(`[${c.claimId} · ${c.kind}] ${c.text}`);
    if (b.counterScenario) lines.push(`반대 시나리오: ${b.counterScenario}`);
    if (b.changeTriggers?.length) lines.push(`판단을 바꿀 조건: ${b.changeTriggers.join(' / ')}`);
    out.push({ kind: 'agent', tab: 'agent', role, title: `${role} · ${ROLES[role].title}${b.bias ? ` · ${b.bias}` : ''}`, lines });
  };

  const analysts = /** @type {Role[]} */ (['TARO', 'DIANA', 'NOVA', 'VIBE']).filter((r) => o.briefings?.[r]);
  if (analysts.length) {
    section(algo ? '애널리스트 팀 브리핑' : '애널리스트 브리핑');
    for (const r of analysts) brief(r, o.briefings[r]);
  }
  if ((o.debate ?? []).length) {
    section('리서치 토론');
    for (const d of /** @type {DebateMessage[]} */ (o.debate)) {
      const lines = [d.narrative];
      if (d.steelman) lines.unshift(`상대의 가장 강한 근거: ${d.steelman}`);
      if (d.openIssues?.length) lines.push(`남은 쟁점: ${d.openIssues.join(' / ')}`);
      out.push({ kind: 'debate', tab: 'debate', role: d.speaker, title: `${d.speaker} · ${d.round}라운드 · ${ROLES[d.speaker].title}`, lines });
    }
  }
  if (o.blitzPlan) {
    section('스캘핑 데스크');
    out.push({ kind: 'agent', tab: 'agent', role: 'BLITZ', title: `BLITZ · 스캘퍼 · ${actionText(o.blitzPlan.action)}`, lines: proposalLines(o.blitzPlan) });
  }
  if (o.briefings?.GUARD) brief('GUARD', o.briefings.GUARD);
  if (o.proposal) {
    section(algo ? '수석 트레이더 1차 판정' : '수석 트레이더 판정');
    out.push({ kind: 'agent', tab: 'agent', role: 'ACE', title: `ACE · 수석 트레이더 · ${actionText(o.proposal.action)}`, lines: proposalLines(o.proposal) });
  }
  if ((o.reviews ?? []).length) {
    section('리스크 위원회 심사');
    for (const r of o.reviews) brief(r.role, r);
  }
  if (o.pm && algo) {
    section('포트폴리오 매니저 최종 심사');
    const lines = [o.pm.narrative];
    if (o.pm.reasonCodes?.length) lines.push(`사유: ${o.pm.reasonCodes.join(', ')}`);
    out.push({ kind: 'agent', tab: 'agent', role: 'PM', title: `PM · 포트폴리오 매니저 · ${({ APPROVE: '승인', MODIFY: '수정승인', REJECT: '기각' })[/** @type {'APPROVE'} */ (o.pm.pmDecision)] ?? o.pm.pmDecision}`, lines });
  }

  const panel = panelModel(job, Date.now());
  if (panel) {
    out.push({ kind: 'final', tab: 'all', title: `>>> 최종 판정: ${panel.headline}${panel.confidence ? ` · 확신도 ${panel.confidence}` : ''} · ${panel.title}`, lines: panel.notes });
  }
  const err = errorView(job);
  if (err) out.push({ kind: 'error', tab: 'all', title: `분석 중단 · ${err.stateLabel} · ${err.code}`, lines: [err.message, ...(err.hint ? [`진단 페이지에서 원인을 확인하세요: ${err.hint}`] : [])] });
  return out;
}

/** @param {any} p TradeProposal */
function proposalLines(p) {
  const lines = [p.rationale];
  lines.push(`확신도 ${confidenceBand(p.confidence)} (${CONFIDENCE_NOTE})`);
  if (p.action !== 'NO_TRADE') {
    lines.push(`진입 ${entryText(p)} · 손절 ${fmtPrice(p.stopLoss)} · 목표 ${(p.targets ?? []).map((/** @type {number} */ t) => fmtPrice(t)).join(', ') || '—'}${p.leverage ? ` · ${p.leverage}배` : ''}`);
  }
  for (const c of p.invalidationConditions ?? []) lines.push(`무효화: ${c}`);
  return lines;
}

/** @param {any} p */
function entryText(p) {
  const e = p.entry ?? {};
  if (e.min !== null && e.max !== null && e.min !== undefined && e.max !== undefined) return e.min === e.max ? fmtPrice(e.min) : `${fmtPrice(e.min)}~${fmtPrice(e.max)}`;
  return e.type === 'market' ? '시장가' : '—';
}

// ---------- 판정 패널 ----------

const STATE_LABEL = /** @type {Record<string, string>} */ ({
  QUEUED: '대기', RESOLVING: '종목 확인', COLLECTING: '데이터 수집', ANALYZING: '애널리스트 분석', DEBATING: '토론', PLANNING: '판정 작성',
  RISK_REVIEW: '리스크 심사', PM_REVIEW: 'PM 심사', FINALIZING: '판정 확정', SAVING: '리포트 저장', COMPLETED: '완료',
  INSUFFICIENT_DATA: '데이터 부족', FAILED: '실패', SCHEMA_ERROR: '응답 형식 오류', BUDGET_EXCEEDED: '상한 도달', CANCELLED: '취소됨', INTERRUPTED: '중단됨',
});

/** @param {string} state @param {Mode} [mode] */
export function stateLabel(state, mode) {
  if (state === 'PM_REVIEW' && mode !== 'algorithm') return '최종 심사';
  return STATE_LABEL[state] ?? state;
}

/**
 * 판정 패널. COMPLETED·INSUFFICIENT_DATA만 판정을 보이고, 실패·취소·상한 도달의 부분 결과는 정상 판정으로 보이지 않는다 (P0-8-R2, P1-1-R4).
 * 제목·표기·배지는 서버의 panelView(P0-2-R2, P0-5-R6)를 그대로 쓰고, 만료는 화면 시각으로 다시 본다 (P0-3-R5).
 * @param {any} job JobView
 * @param {number} nowMs
 */
export function panelModel(job, nowMs) {
  if (!job || !job.panel || !job.finalDecision || !['COMPLETED', 'INSUFFICIENT_DATA'].includes(job.state)) return null;
  const d = job.finalDecision;
  /** @type {string[]} */
  const badges = [...job.panel.badges];
  if (job.demo) badges.unshift(DEMO_MARK); // P1-8-R4: 결과 패널 안에도
  if (d.validUntil && Date.parse(d.validUntil) < nowMs && !badges.includes('만료')) badges.push('만료');
  const p = d.proposal;
  /** @type {{ label: string; value: string }[]} */
  const rows = [];
  if (p && d.action !== 'NO_TRADE') {
    rows.push({ label: '진입', value: entryText(p) });
    rows.push({ label: '손절', value: fmtPrice(p.stopLoss) });
    rows.push({ label: '목표', value: (p.targets ?? []).map((/** @type {number} */ t) => fmtPrice(t)).join(' / ') || '—' });
    if (p.leverage) rows.push({ label: '레버리지', value: `${p.leverage}배` });
  }
  const risk = d.risk
    ? { label: MARGIN_LABEL, value: `${fmtPrice(d.risk.roughMarginLimitPrice)} (기준가 대비 ${d.risk.roughMarginLimitPercent}%) · 손절 거리 ${d.risk.stopDistancePercent}% · 여유 비율 ${d.risk.bufferRatio}`, assumptions: d.risk.assumptions }
    : null;
  return {
    demo: job.demo === true,
    simulation: d.forcedDirection === true,
    badges,
    title: job.panel.title,
    headline: job.panel.headline,
    tone: job.panel.tone,
    // 강제 방향의 근거 부족 표기는 notes 맨 앞에 온다 (panelView). 화면은 notes를 방향 표시보다 먼저 그린다
    notes: /** @type {string[]} */ (job.panel.notes),
    confidence: d.confidence ? d.confidence.band : null,
    confidenceNote: d.confidence ? CONFIDENCE_NOTE : null,
    rows,
    risk,
    violations: /** @type {string[]} */ ((d.ruleEngine?.violations ?? []).map((/** @type {any} */ v) => `${v.code} ${v.message}`)),
    maker: d.finalDecisionMaker,
    rationale: p?.rationale ?? null,
  };
}

/**
 * 오류 안내 (P1-1-T3, P1-8-R6). 진행 중이거나 완료면 null
 * @param {any} job
 */
export function errorView(job) {
  if (!job?.error || !job.terminal || job.state === 'COMPLETED') return null;
  return { code: job.error.code, message: job.error.message, hint: job.error.hint ?? null, role: job.error.role ?? null, stateLabel: stateLabel(job.state, job.mode) };
}

/**
 * 역할별 진행 표시: 호출 중(thinking) → 완료(done)
 * @param {any} job @param {Set<string>} calling
 * @returns {Partial<Record<Role, 'thinking' | 'done'>>}
 */
export function roleStatus(job, calling) {
  /** @type {Partial<Record<Role, 'thinking' | 'done'>>} */
  const out = {};
  for (const c of job?.usage?.calls ?? []) if (c.outcome === 'ok') out[/** @type {Role} */ (c.role)] = 'done';
  for (const r of calling) out[/** @type {Role} */ (r)] = 'thinking';
  return out;
}

// ---------- 전광판 ----------

/**
 * 멀티 거래소 전광판 행 (P1-2-R10: 추정값은 배지·산출 거래소·산출 시각과 함께)
 * @param {any} board
 * @returns {{ label: string; value: string; change?: string; note: string; tone?: 'estimate' | 'spread' | 'fail' }[]}
 */
export function multiRows(board) {
  const m = board?.multi;
  if (!m) return [];
  const rows = [];
  rows.push({ label: '환율 USD/KRW', value: m.fx ? fmtPrice(m.fx.rate, 'KRW') : '—', note: m.fx ? 'Yahoo KRW=X' : '환율 조회 실패', ...(m.fx ? {} : { tone: /** @type {const} */ ('fail') }) });
  rows.push({ label: `KRX ${board.instrumentId.replace(/^KR:/, '')} 현물`, value: m.krxSpot ? fmtPrice(m.krxSpot.value, 'KRW') : '—', note: m.krxSpot?.usd ? `≈ ${fmtPrice(m.krxSpot.usd, 'USD')}` : '' });
  const e = m.estimate;
  rows.push({
    label: '탭비트 USDT 무기한', value: e.value === null ? '산출 불가' : fmtPrice(e.value, 'USDT'), tone: /** @type {const} */ ('estimate'),
    note: `${e.badge} · ${e.value === null ? e.reason ?? '' : `${e.exchanges.join('·')} 중앙값`} · 산출 ${e.computedAt.slice(11, 19)} UTC`,
  });
  for (const p of m.perps) {
    if (p.status !== 'ok') {
      rows.push({ label: `${p.label} ${p.symbol}`, value: '—', note: `조회 실패 · ${p.error ?? ''}`, tone: /** @type {const} */ ('fail') });
      continue;
    }
    const extra = [p.krw ? fmtPrice(p.krw, 'KRW') : null, p.fundingRate8h !== null ? `펀딩 ${fmtChange(p.fundingRate8h, 4)}/8h` : null, p.index ? `지수 ${fmtPrice(p.index)}` : null, p.observedAt ? null : '시각 미확인'].filter(Boolean);
    rows.push({ label: `${p.label} ${p.symbol}`, value: fmtPrice(p.last, 'USDT'), note: extra.join(' · ') });
  }
  if (m.spread) rows.push({ label: '선물↔KRX 괴리', value: fmtChange(m.spread.value), note: m.spread.assumptions.join(' · '), tone: /** @type {const} */ ('spread') });
  return rows;
}
