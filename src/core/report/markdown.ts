// 리포트 Markdown 생성 (P1-6-R1). 입력은 리포트 JSON뿐이고 같은 JSON이면 항상 같은 문서가 나온다.
// 모델이 쓴 문장은 HTML 태그처럼 해석되지 않게 무력화한다 (P1-7.4).
import type { EvidenceIssue } from '../rules/audit.ts';
import type { Briefing } from '../schema/agents.ts';
import type { TradeProposal } from '../schema/proposal.ts';
import { actionBiasLabel, BIAS_NOTE, CONFIDENCE_BAND_LABEL, CONFIDENCE_NOTE, panelView } from '../rules/display.ts';
import type { Report } from './report.ts';

const MODE_LABEL = { algorithm: '알고리즘', scalp: '스캘핑 20x', forced_direction: '강제 방향 시뮬레이션' } as const;

/** 모델·외부 문장: 제어 문자 제거, 태그 시작 무력화, 줄바꿈은 공백으로 */
export function mdText(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/<(?=[A-Za-z/!?])/g, '&lt;')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

const num = (v: number | null | undefined) => (v === null || v === undefined ? '-' : String(Number(v.toFixed(8))));
const list = (xs: readonly string[]) => (xs.length ? xs.map(mdText).join(', ') : '-');

function headerNotices(r: Report): string[] {
  const out: string[] = [];
  if (r.demo) out.push('**DEMO · 실제 데이터 아님** — 미리 준비한 응답을 재생한 결과입니다 (P1-8-R4)');
  if (r.resultClass === 'simulation') out.push('**강제 방향 시뮬레이션 — 투자 판정이 아닙니다**');
  if (r.resultClass === 'lightweight') out.push('**간이 분석 — 데이터 고정·판정 검증 미적용**');
  if (r.analystIndependence === 'shared_context') out.push('**단일 세션 분석** — 한 세션이 모든 역할을 수행해 애널리스트 독립성이 완전하지 않습니다');
  return out;
}

function proposalLines(p: TradeProposal): string[] {
  const lines = [
    `- 작성: ${p.author} · ${actionBiasLabel(p.action, p.bias)}${p.unforcedAction ? ` · 강제 없을 때: ${p.unforcedAction}` : ''}`,
    `- 진입: ${p.entry.type} ${num(p.entry.min)} ~ ${num(p.entry.max)} · 손절: ${num(p.stopLoss)} · 목표: ${p.targets.length ? p.targets.map(num).join(', ') : '-'}`,
    `- 레버리지: ${p.leverage ?? '-'} · 시간 단위: ${p.timeframe} · 보유 예상: ${mdText(p.expectedHoldingPeriod)} · 유효 ${p.validForMinutes}분`,
    `- 기준 가격: ${p.priceBasis.sourceRef} (${p.priceBasis.currency})`,
    `- 근거: ${list(p.evidenceRefs)}`,
    `- 무효화 조건: ${list(p.invalidationConditions)}`,
  ];
  if (p.warnings.length) lines.push(`- 경고: ${list(p.warnings)}`);
  lines.push('', `> ${mdText(p.rationale)}`);
  return lines;
}

/** 주장 옆 표시 (P1-10-R1): 같은 역할·claimId의 근거 검사 결과 이름 */
function claimMarks(issues: readonly EvidenceIssue[], role: string, claimId: string): string {
  const labels = [...new Set(issues.filter((x) => x.role === role && x.claimId === claimId).map((x) => x.label))];
  return labels.map((l) => ` ⚠ ${l}`).join('');
}

function briefingLines(b: Briefing, issues: readonly EvidenceIssue[]): string[] {
  const lines = [`### ${b.role} · ${b.bias}`, '', `**${mdText(b.summary)}**`, '', mdText(b.narrative), ''];
  for (const c of b.claims) lines.push(`- \`${c.claimId}\` (${c.kind}) ${mdText(c.text)}${c.evidenceRefs.length ? ` — ${c.evidenceRefs.map(mdText).join(', ')}` : ''}${claimMarks(issues, b.role, c.claimId)}`);
  lines.push(`- 반대 시나리오: ${mdText(b.counterScenario)}`);
  if (b.changeTriggers.length) lines.push(`- 판단을 바꿀 조건: ${list(b.changeTriggers)}`);
  if (b.dataLimitations.length) lines.push(`- 데이터 한계: ${list(b.dataLimitations)}`);
  lines.push('');
  return lines;
}

export function renderMarkdown(r: Report): string {
  const d = r.finalDecision;
  const v = panelView(d, new Date(r.completedAt));
  const L: string[] = [];
  L.push(`# ${mdText(r.displayName)} · ${MODE_LABEL[r.mode]} · ${v.title}`, '');
  for (const n of headerNotices(r)) L.push(`> ${n}`, '');
  L.push(
    `- 종목: ${mdText(r.symbolInput)} → ${r.instrumentId} (${r.snapshot.marketType})`,
    `- 작업: ${r.jobId} · 완료 ${r.completedAt} · 소요 ${r.usage.durationSeconds}초`,
    `- 실행: ${r.interface === 'floor' ? '/floor' : '브라우저'} (${r.executionBackend}) · 최종 의사결정자 ${d.finalDecisionMaker}`,
    '',
  );

  L.push('## 최종 판정', '');
  if (v.badges.length) L.push(`[${v.badges.join('] [')}]`, '');
  L.push(`**${v.headline}**`, '');
  for (const n of v.notes) if (n !== BIAS_NOTE) L.push(`- ${n}`);
  if (d.action === 'NO_TRADE') L.push(`- 방향 판단(${d.bias}): ${BIAS_NOTE}`);
  if (d.confidence) L.push(`- 확신도: ${d.confidence.band} (${CONFIDENCE_BAND_LABEL[d.confidence.band]}) · 보정 전 점수 ${d.confidence.score} · ${CONFIDENCE_NOTE}`);
  L.push(`- 상태: ${d.status} · 규칙 엔진 ${d.ruleEngine.verdict}${d.reasonCodes.length ? ` · 사유 ${d.reasonCodes.join(', ')}` : ''}`);
  if (d.pmDecision) L.push(`- PM 결정: ${d.pmDecision}${d.modifiedFields.length ? ` (변경: ${d.modifiedFields.join(', ')})` : ''}`);
  if (d.validUntil) L.push(`- 유효 기한: ${d.validUntil}`);
  for (const x of d.ruleEngine.violations) L.push(`- 위반 ${x.code}: ${mdText(x.message)}`);
  for (const w of d.ruleEngine.warnings) L.push(`- 경고: ${mdText(w)}`);
  L.push('');
  if (d.proposal) L.push('### 채택된 제안', '', ...proposalLines(d.proposal), '');
  if (d.risk) {
    const k = d.risk;
    L.push(
      '### 레버리지 위험 거리',
      '',
      `- 레버리지 ${k.leverage}배 · 손절 거리 ${num(k.stopDistancePercent)}% · 버퍼 비율 ${num(k.bufferRatio)}`,
      `- 단순 계산상 증거금 소진 지점 (참고): ${num(k.roughMarginLimitPrice)} (기준 가격 ${k.basePriceKind} ${num(k.basePrice)}에서 ${num(k.roughMarginLimitPercent)}%)`,
      `- 가정: ${k.assumptions.join(', ')}`,
      '',
    );
  }

  L.push('## 데이터 스냅샷', '');
  const s = r.snapshot;
  L.push(
    `- 스냅샷 ${s.snapshotId} · 해시 \`${s.snapshotHash}\` · 수집 ${s.collectedAt}`,
    `- 데이터 품질: ${s.dataQuality.status} (필수 ${s.dataQuality.requiredOk}, 선택 완성도 ${Math.round(s.dataQuality.optionalCompleteness * 100)}%) · 시장 ${s.market.label}`,
  );
  for (const w of s.dataQuality.warnings) L.push(`- 경고: ${mdText(w)}`);
  L.push('', '| 소스 | 상태 | 신선도 | 사용 |', '|---|---|---|---|');
  for (const x of s.sources) L.push(`| ${x.id}${x.estimated ? ' (추정 · 직접 체결가 아님)' : ''} | ${x.status} | ${x.freshness} | ${x.usable ? '예' : '아니오'} |`);
  L.push('');

  const audit = r.evidenceAudit ?? []; // Phase 9 이전 리포트에는 없다
  const briefs = Object.values(r.briefings).filter((b): b is Briefing => Boolean(b));
  const analysts = briefs.filter((b) => b.role !== 'GUARD');
  if (analysts.length) {
    L.push('## 애널리스트 브리핑', '');
    for (const b of analysts) L.push(...briefingLines(b, audit));
  }

  if (r.mode === 'algorithm') {
    L.push('## 토론', '', `- ${r.debate.roundCount}라운드 (최대 ${r.debate.maxRounds}) · 종료 사유 ${r.debate.stopReason ?? '-'}`, '');
    for (const m of r.debate.messages) {
      L.push(`### ${m.speaker} · ${m.round}라운드`, '', `**${mdText(m.summary)}**`, '', mdText(m.narrative), '');
      if (m.steelman) L.push(`- 상대 논거 요약: ${mdText(m.steelman)}`);
      L.push(`- 근거: ${list(m.evidenceRefs)}`, `- 남은 쟁점: ${list(m.openIssues)}`, '');
    }
  }

  const others = r.proposals.filter((p) => p !== d.proposal && !(d.proposal && p.author === d.proposal.author));
  if (others.length) {
    L.push('## 채택되지 않은 제안', '');
    for (const p of others) L.push(`### ${p.author}`, '', ...proposalLines(p), '');
  }

  L.push('## 리스크 심사', '', `- 심사자: ${r.riskReview.reviewers.join(', ') || '-'} · 시점: ${r.riskReview.timing === 'post_proposal' ? '제안 후' : '제안 전'}`, '');
  for (const b of r.mode === 'algorithm' ? r.reviews : briefs.filter((x) => x.role === 'GUARD')) L.push(...briefingLines(b, audit));

  if (r.pm) {
    L.push('## PM 심사', '', `- 결정: ${r.pm.pmDecision} · 사유 코드: ${list(r.pm.reasonCodes)}`);
    if (r.pm.modifiedFields.length) L.push(`- 변경 필드(코드 계산): ${r.pm.modifiedFields.join(', ')}`);
    L.push('', `**${mdText(r.pm.summary)}**`, '', mdText(r.pm.narrative), '');
  }

  L.push('## 근거 검사', '');
  if (audit.length === 0) L.push('- 문제 없음');
  for (const x of audit) {
    const where = x.claimId ? `${x.role} ${x.claimId}` : x.round !== null ? `${x.role} ${x.round}라운드` : x.role;
    L.push(`- ${x.label} · ${where}${x.ref ? ` · ${mdText(x.ref)}` : ''} — ${mdText(x.detail)}`);
  }
  L.push('');

  L.push('## 과거 판정 회고', '', `- 과거 판정 회고: ${r.retrospective.enabled ? '켜짐' : '꺼짐'} (P1-9)`, '');

  L.push('## 실행 기록', '');
  const u = r.usage;
  L.push(
    `- 호출 ${u.modelCallCount}회 (계획 ${u.plannedModelCallRange.min}~${u.plannedModelCallRange.max}, 재시도 ${u.retryCallCount})${u.roleTurnCount !== null ? ` · 역할 발언 ${u.roleTurnCount}회` : ''}`,
    `- 애널리스트 독립성: ${r.analystIndependence} · 예산 강제: ${r.budgetEnforcement}`,
    `- 버전: 앱 ${r.appVersion} · 코어 ${r.coreVersion} · 규칙 ${r.versions.ruleEngine} · 지표 ${r.versions.indicators} · 달력 ${r.versions.calendar} · 레지스트리 ${r.versions.registry} · Claude CLI ${r.versions.claudeCli}`,
    '',
    '| 역할 | 프롬프트 해시 | 모델(보고값) |',
    '|---|---|---|',
  );
  for (const [role, h] of Object.entries(r.versions.prompts)) L.push(`| ${role} | \`${h}\` | ${r.versions.models[role as keyof typeof r.versions.models] ?? 'unknown'} |`);
  if (r.warnings.length) {
    L.push('');
    for (const w of r.warnings) L.push(`- 작업 경고: ${mdText(w)}`);
  }
  L.push('', '---', '분석 시뮬레이션 결과이며 실제 주문 기능은 없습니다. 투자 조언이 아닙니다.', '');
  return L.join('\n');
}
