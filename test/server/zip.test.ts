import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildZip } from '../../src/server/zip.ts';
import { isExcluded, listBundleFiles } from '../../src/server/bundle.ts';
import { readZip } from './zip-reader.ts';

test('buildZip: 한글 파일명·빈 파일·압축 데이터를 되읽을 수 있다', () => {
  const files = [
    { name: 'docs/명세-v1.md', data: Buffer.from('# 제목\n'.repeat(200)) },
    { name: 'empty.txt', data: Buffer.alloc(0) },
    { name: 'a/b/c.json', data: Buffer.from('{"x":1}') },
  ];
  const z = buildZip(files, new Date('2026-09-29T12:34:56Z'));
  const back = readZip(z);
  assert.deepEqual(back.map((e) => e.name), files.map((f) => f.name));
  for (const [i, e] of back.entries()) assert.ok(e.data.equals(files[i]!.data), e.name);
});

test('P1-7-T5 project.zip 목록은 .claude/, credentials, .env, 키 파일, reports/jobs/logs/node_modules/.git을 항상 뺀다', () => {
  const root = mkdtempSync(join(tmpdir(), 'floor-bundle-'));
  const put = (rel: string, text = 'x') => {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  for (const rel of [
    'package.json', 'src/a.ts', 'docs/명세.md', 'fixtures/demo/v1/manifest.json',
    '.claude/settings.json', '.claude/skills/x/SKILL.md', 'src/.claude/x', '.credentials.json', 'config/my.credentials.bak',
    '.env', '.env.local', 'src/.env.production', 'server.key', 'certs/c.pem', 'node_modules/p/index.js', 'reports/r.json',
    'jobs/j/job.json', 'logs/l.txt', '.git/config', 'src/nested/node_modules/q.js',
  ]) put(rel);
  symlinkSync(join(root, 'package.json'), join(root, 'link.json'));
  const list = listBundleFiles(root);
  assert.deepEqual(list.files.map((f) => f.path).sort(), ['docs/명세.md', 'fixtures/demo/v1/manifest.json', 'package.json', 'src/a.ts']);
  assert.equal(list.totalBytes, 4);
  assert.match(list.listHash, /^[0-9a-f]{16}$/);
  // 파일이 바뀌면 목록 해시도 바뀐다 (확인한 목록과 다르면 만들지 않는다)
  put('src/b.ts');
  assert.notEqual(listBundleFiles(root).listHash, list.listHash);
  // 산출물 검사
  const z = readZip(buildZip(list.files.map((f) => ({ name: f.path, data: Buffer.from('x') }))));
  assert.equal(z.some((e) => e.name.includes('.claude/') || e.name.includes('credentials')), false);
});

test('isExcluded: 경로 조각 단위로 판정', () => {
  assert.ok(isExcluded('.claude'));
  assert.ok(isExcluded('a/.env.test'));
  assert.ok(isExcluded('x.PEM'));
  assert.equal(isExcluded('src/environment.ts'), false);
  assert.equal(isExcluded('src/reports-view.ts'), false);
});
