// 리포트 열람용 Markdown → HTML (P1-7-R11). 원시 HTML은 허용하지 않는다: 모든 글자를 먼저 이스케이프하고, 이 파일이 만든 태그만 넣는다.
// 링크는 http·https만 rel="noopener noreferrer"로 만들고, 이미지는 불러오지 않고 대체 글자로 보인다.
// 리포트 Markdown(src/core/report/markdown.ts)이 쓰는 문법만 지원한다: 제목, 문단, 목록, 표, 인용, 코드, 굵게, 링크, 구분선.
import { escapeHtml } from './pages.ts';

/** 한 줄 안의 서식. 코드 → 이미지·링크 → 굵게 순서로 자르고, 조각마다 이스케이프한다 */
export function inlineHtml(text: string): string {
  let out = '';
  const re = /`([^`]+)`|(!?)\[([^\]]*)\]\(\s*((?:[^()\s]|\([^()\s]*\))*)\s*\)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out += strong(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] !== undefined) {
      out += `<code>${escapeHtml(m[1])}</code>`;
    } else if (m[2] === '!') {
      out += `[이미지: ${strong(m[3]!)}]`; // 외부 이미지 금지
    } else {
      const href = safeHref(m[4]!);
      out += href ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${strong(m[3]!)}</a>` : strong(m[3]!);
    }
  }
  return out + strong(text.slice(last));
}

function strong(s: string): string {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

export function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') { i++; continue; }
    if (line.startsWith('```')) {
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i]!.startsWith('```'); i++) body.push(lines[i]!);
      i++;
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      out.push(`<h${h[1]!.length}>${inlineHtml(h[2]!)}</h${h[1]!.length}>`);
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (line.startsWith('>')) {
      const body: string[] = [];
      for (; i < lines.length && lines[i]!.startsWith('>'); i++) body.push(lines[i]!.replace(/^>\s?/, ''));
      out.push(`<blockquote>${markdownToHtml(body.join('\n'))}</blockquote>`);
      continue;
    }
    if (line.trim().startsWith('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? '')) {
      const head = cells(line);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i]!.trim().startsWith('|'); i++) rows.push(cells(lines[i]!));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inlineHtml(c)}</th>`).join('')}</tr></thead><tbody>${
        rows.map((r) => `<tr>${r.map((c) => `<td>${inlineHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const list = /^(\s*)([-*]|\d+\.)\s+/.exec(line);
    if (list) {
      const ordered = /\d/.test(list[2]!);
      const item = ordered ? /^\s*\d+\.\s+(.*)$/ : /^\s*[-*]\s+(.*)$/;
      const items: string[] = [];
      for (; i < lines.length; i++) {
        const m = item.exec(lines[i]!);
        if (!m) break;
        items.push(`<li>${inlineHtml(m[1]!)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    const para: string[] = [];
    for (; i < lines.length && lines[i]!.trim() !== '' && !/^(#{1,6}\s|>|```|\s*[-*]\s|\s*\d+\.\s|\|)/.test(lines[i]!); i++) para.push(lines[i]!);
    if (para.length === 0) { para.push(line); i++; }
    out.push(`<p>${para.map(inlineHtml).join('<br>')}</p>`);
  }
  return out.join('\n');
}
