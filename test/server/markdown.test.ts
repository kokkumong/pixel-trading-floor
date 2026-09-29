import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHtml } from '../../src/server/markdown.ts';

test('P1-7-T2 Markdown 렌더러: 원시 HTML은 글자로만, javascript:·data: 링크는 링크가 되지 않는다', () => {
  const md = [
    '# 제목 <script>alert(1)</script>',
    '',
    '본문 <img src=x onerror=alert(1)> **굵게** [클릭](javascript:alert(1)) [데이터](data:text/html,x) [공백]( javascript:alert(1))',
    '',
    '- 항목 <b onmouseover=alert(1)>x</b>',
    '> 인용 [정상](https://example.com/a?b=1&c="2")',
    '![외부 이미지](https://example.com/x.png)',
  ].join('\n');
  const h = markdownToHtml(md);
  assert.equal(/<script|<img|<b /i.test(h), false, h);
  assert.equal(/href="(javascript|data):/i.test(h), false, h);
  assert.equal(/<[a-z][^>]*\son\w+\s*=/i.test(h), false, '태그 안에 이벤트 속성이 없다');
  assert.ok(h.includes('&lt;img src=x onerror=alert(1)&gt;'), '글자로는 보인다');
  assert.ok(h.includes('<strong>굵게</strong> 클릭 데이터 공백</p>'), h);
  // http/https 링크만, rel="noopener noreferrer", 속성값은 이스케이프
  assert.ok(h.includes('<a href="https://example.com/a?b=1&amp;c=%222%22" rel="noopener noreferrer">정상</a>'), h);
  // 외부 이미지는 불러오지 않는다 (P1-7-R11)
  assert.equal(/<img|src="/.test(h), false);
  assert.ok(h.includes('외부 이미지'));
});

test('Markdown 렌더러: 리포트에 쓰는 문법(제목·목록·표·인용·굵게·코드)을 그린다', () => {
  const md = [
    '# 비트코인 (BTC)',
    '',
    '> **DEMO · 실제 데이터 아님** — 재생',
    '',
    '- 종목: `CRYPTO:BTC`',
    '- 둘째 **굵게**',
    '',
    '| 소스 | 상태 |',
    '|---|---|',
    '| binance.spot.price | ok |',
    '',
    '1. 하나',
    '2. 둘',
    '',
    '```',
    '<raw> & code',
    '```',
    '',
    '---',
  ].join('\n');
  const h = markdownToHtml(md);
  assert.ok(h.includes('<h1>비트코인 (BTC)</h1>'));
  assert.ok(h.includes('<blockquote><p><strong>DEMO · 실제 데이터 아님</strong> — 재생</p></blockquote>'), h);
  assert.ok(h.includes('<ul><li>종목: <code>CRYPTO:BTC</code></li><li>둘째 <strong>굵게</strong></li></ul>'), h);
  assert.ok(h.includes('<table><thead><tr><th>소스</th><th>상태</th></tr></thead><tbody><tr><td>binance.spot.price</td><td>ok</td></tr></tbody></table>'), h);
  assert.ok(h.includes('<ol><li>하나</li><li>둘</li></ol>'));
  assert.ok(h.includes('<pre><code>&lt;raw&gt; &amp; code</code></pre>'));
  assert.ok(h.includes('<hr>'));
});
