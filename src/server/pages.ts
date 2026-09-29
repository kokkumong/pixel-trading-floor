// 서버가 그리는 HTML 페이지: 리포트 목록·열람, 진단, project.zip 확인. 스크립트 없이 동작한다.
// 모델 출력과 외부 텍스트는 모두 이스케이프하고 원시 HTML을 허용하지 않는다 (P1-7-R11). 링크는 서버가 만든 경로만 쓴다.
import type { Check, DiagResult } from '../core/diag.ts';
import type { Report, ReportTab } from '../core/report/report.ts';
import type { ReportSummary } from '../core/report/store.ts';
import { actionBiasLabel, statusLabel } from '../core/rules/display.ts';
import type { BundleList } from './bundle.ts';

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** 태그드 템플릿: ${} 값은 모두 이스케이프한다. 이미 만든 조각은 raw()로 감싼다 */
export class Raw {
  readonly html: string;
  constructor(html: string) {
    this.html = html;
  }
}

export const raw = (html: string) => new Raw(html);

export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = strings[0]!;
  values.forEach((v, i) => {
    const part = Array.isArray(v) ? v.map((x) => (x instanceof Raw ? x.html : escapeHtml(String(x)))).join('') : v instanceof Raw ? v.html : escapeHtml(String(v ?? ''));
    out += part + strings[i + 1]!;
  });
  return new Raw(out);
}

export interface PageContext {
  lanBanner: string | null;
  demo?: boolean;
}

export function page(title: string, body: Raw, ctx: PageContext): string {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · PIXEL TRADING FLOOR</title>
<link rel="stylesheet" href="/web/app.css">
</head>
<body>
${ctx.lanBanner ? html`<div class="banner warn">${ctx.lanBanner}</div>`.html : ''}
${ctx.demo ? '<div class="watermark" aria-hidden="true">DEMO · 실제 데이터 아님</div>' : ''}
<nav class="top"><a href="/">FLOOR</a> <a href="/reports">리포트</a> <a href="/diagnostics">진단</a></nav>
<main>
${body.html}
</main>
</body>
</html>`;
}

const TAB_LABEL: Record<ReportTab, string> = { analysis: '분석', simulation: '시뮬레이션', lightweight: '간이', demo: '데모' };
const MODE_LABEL = { algorithm: '알고리즘', scalp: '스캘핑 20x', forced_direction: '강제 방향 시뮬레이션' } as const;

function verdictLabel(s: Pick<ReportSummary, 'action' | 'bias' | 'status'>): string {
  return s.action && s.bias ? actionBiasLabel(s.action, s.bias) : statusLabel(s.status);
}

export function reportsPage(tab: ReportTab, items: ReportSummary[], canZip: boolean): Raw {
  const tabs = (Object.keys(TAB_LABEL) as ReportTab[]).map((t) =>
    t === tab ? html`<strong>${TAB_LABEL[t]}</strong>` : html`<a href="/reports?tab=${t}">${TAB_LABEL[t]}</a>`);
  const rows = items.map((r) => html`<tr>
<td>${r.completedAt.replace('T', ' ').slice(0, 19)}</td>
<td><a href="/reports/${r.jobId}">${r.displayName}</a></td>
<td>${MODE_LABEL[r.mode]}${r.demo ? ' · DEMO' : ''}</td>
<td>${verdictLabel(r)}</td>
<td><a href="/reports/${r.jobId}.md">MD</a> <a href="/reports/${r.jobId}.json">JSON</a></td>
</tr>`);
  return html`<h1>리포트</h1>
<p class="tabs">${tabs}</p>
${tab === 'analysis' && canZip ? html`<p><a href="/reports/all.zip">전체 분석 리포트 ZIP 받기</a></p>` : raw('')}
${items.length === 0 ? html`<p>리포트가 없습니다.</p>` : html`<table><thead><tr><th>완료 시각</th><th>종목</th><th>모드</th><th>결과</th><th>파일</th></tr></thead><tbody>${rows}</tbody></table>`}`;
}

export function reportPage(r: Report, markdown: string): Raw {
  return html`<h1>${r.displayName} · ${MODE_LABEL[r.mode]}</h1>
${r.demo ? html`<p class="badge demo">DEMO · 실제 데이터 아님</p>` : raw('')}
${r.resultClass === 'simulation' ? html`<p class="badge sim">강제 방향 시뮬레이션 · 판정 아님</p>` : raw('')}
<p><a href="/reports/${r.jobId}.md">Markdown 받기</a> · <a href="/reports/${r.jobId}.json">JSON 받기</a> · <a href="/reports">목록</a></p>
<pre class="report">${markdown}</pre>`;
}

const MARK: Record<Check['status'], string> = { ok: '✓', warn: '!', error: '✗', skip: '-' };

export function diagnosticsPage(d: DiagResult, claudeTested: boolean): Raw {
  const rows = d.checks.map((c) => html`<tr class="${c.status}"><td>${MARK[c.status]}</td><td>${c.label}</td><td>${c.detail}${c.code ? ` (${c.code})` : ''}</td><td>${c.status === 'ok' ? '' : c.hint ?? ''}</td></tr>`);
  return html`<h1>진단</h1>
<p>${d.ok ? '필수 검사를 모두 통과했습니다.' : '오류가 있는 항목을 먼저 해결하세요.'}</p>
<table><thead><tr><th></th><th>검사</th><th>결과</th><th>안내</th></tr></thead><tbody>${rows}</tbody></table>
${claudeTested ? raw('') : html`<form method="post" action="/diagnostics/claude-test"><button type="submit">Claude 시험 호출 (호출 1회 소모)</button></form>`}`;
}

export function projectZipPage(list: BundleList): Raw {
  const kb = (n: number) => `${(n / 1024).toFixed(1)}KB`;
  return html`<h1>프로젝트 번들 (project.zip)</h1>
<p>아래 ${list.files.length}개 파일(${kb(list.totalBytes)})이 들어갑니다. 인증 정보(.claude/, credentials, .env, 키 파일)와 reports/·jobs/·logs/·node_modules/·.git은 항상 빠집니다.</p>
<p><a href="/project.zip?confirm=${list.listHash}">이 목록으로 project.zip 받기</a></p>
<ul class="files">${list.files.map((f) => html`<li>${f.path} <span>${kb(f.size)}</span></li>`)}</ul>`;
}

export function messagePage(title: string, message: string): Raw {
  return html`<h1>${title}</h1><p>${message}</p>`;
}
