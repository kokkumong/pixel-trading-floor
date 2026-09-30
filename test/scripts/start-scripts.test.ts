// 더블클릭 시작 파일 (P0-7.6, P2-7). macOS .command는 bash로 실제 실행해 보고, Windows .cmd는 내용만 검사한다 (CI는 Linux).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const read = (name: string) => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MAC = ['start-floor.command', 'start-floor-lan.command'] as const;
const WIN = ['start-floor.cmd', 'start-floor-lan.cmd'] as const;
/** 서버를 띄우는 줄 */
const serverLine = (text: string) => text.split(/\r\n/).find((l) => /src\\server\\main\.ts/.test(l)) ?? '';

test('P0-7.6 · P0-7-R12 · P2-7-R2 start-floor.cmd: 로컬 전용으로 --open --doctor 시작, 서버 출력을 파일로 남기지 않는다', () => {
  const s = read('start-floor.cmd');
  const line = serverLine(s);
  assert.match(line, /^node src\\server\\main\.ts --open --doctor$/);
  assert.doesNotMatch(s, /--lan/);
});

test('P0-7.6 · P2-7-R2 start-floor-lan.cmd: --lan --open --doctor 시작, 신뢰 네트워크·읽기 전용·2시간 안내, 출력을 파일로 남기지 않는다', () => {
  const s = read('start-floor-lan.cmd');
  assert.match(serverLine(s), /^node src\\server\\main\.ts --lan --open --doctor$/);
  assert.match(s, /공용/);
  assert.match(s, /읽기 전용/);
  assert.match(s, /2시간/);
});

test('P0-7.6 시작 스크립트 공통: CRLF, UTF-8 코드 페이지, 스크립트 폴더에서 실행, 리다이렉트·로그 파일 없음', () => {
  for (const name of WIN) {
    const s = read(name);
    assert.equal(s.split('\n').length, s.split('\r\n').length, `${name} CRLF`);
    assert.match(s, /^chcp 65001 ?>nul$/m, name);
    assert.match(s, /^cd \/d "%~dp0"$/m, name);
    // 토큰 주소가 서버 창에 찍히므로 서버 출력은 어디에도 옮기지 않는다 (>nul로 버리는 준비 명령만 허용)
    const redirects = s.split('\r\n').filter((l) => !/^\s*rem /i.test(l)).flatMap((l) => l.replace(/"[^"]*"/g, '""').match(/\d?>>?\s*(?!nul\b)\S+|\|\s*\S+/gi) ?? []);
    assert.deepEqual(redirects.filter((r) => !/^\d?>&\d|^\|\|/.test(r)), [], name);
    assert.doesNotMatch(s, /\btee\b|\.log\b|Out-File|clip\b/i, name);
    assert.doesNotMatch(serverLine(s), /[>|]/, name);
  }
});

/** 가짜 node: -p는 버전을 출력, -e(버전 검사)는 그 버전으로 판정, 그 밖에는 받은 인자를 파일에 쓴다 */
function fakeNode(version: string): { dir: string; argsFile: string } {
  const dir = mkdtempSync(join(tmpdir(), 'floor-fake-node-'));
  const argsFile = join(dir, 'args.txt');
  const [a, b] = version.split('.').map(Number) as [number, number];
  const ok = a > 22 || (a === 22 && b >= 18) ? 0 : 1;
  writeFileSync(join(dir, 'node'), `#!/bin/sh
case "$1" in
  -p) echo ${version} ;;
  -e) exit ${ok} ;;
  *) echo "$@" > "${argsFile}" ;;
esac
`);
  chmodSync(join(dir, 'node'), 0o755);
  return { dir, argsFile };
}

/** version이 null이면 PATH에 node가 없는 상태 */
function runMac(file: string, version: string | null) {
  const fake = version === null ? { dir: mkdtempSync(join(tmpdir(), 'floor-no-node-')), argsFile: '' } : fakeNode(version);
  const home = mkdtempSync(join(tmpdir(), 'floor-home-'));
  const r = spawnSync('/bin/bash', [join(ROOT, file)], {
    cwd: tmpdir(), // 파일 위치로 옮겨 가는지 본다
    env: { PATH: `${fake.dir}:/usr/bin:/bin`, HOME: home, FLOOR_NODE_SEARCH: '' }, // 이 PC에 설치된 다른 node를 찾지 않게
    input: '', encoding: 'utf8', timeout: 10_000,
  });
  let args = '';
  try { args = fake.argsFile ? readFileSync(fake.argsFile, 'utf8').trim() : ''; } catch { /* node로 서버를 시작하지 않음 */ }
  return { ...r, args };
}

test('P2-7-R1 macOS 시작 파일: 실행 권한이 있고, LF 줄바꿈의 bash 스크립트다', { skip: process.platform === 'win32' }, () => {
  for (const f of MAC) {
    assert.ok((statSync(join(ROOT, f)).mode & 0o111) !== 0, `${f} 실행 권한`);
    const s = read(f);
    assert.ok(s.startsWith('#!/bin/bash\n'), f);
    assert.equal(s.includes('\r'), false, `${f} CRLF가 있으면 macOS에서 실행되지 않는다`);
  }
});

test('P2-7-R1, R2 macOS 시작 파일: 파일 위치에서 서버를 --open --doctor로 시작한다 (LAN 파일은 --lan 추가)', { skip: process.platform === 'win32' }, () => {
  const local = runMac('start-floor.command', '22.23.2');
  assert.equal(local.status, 0, local.stderr);
  assert.equal(local.args, 'src/server/main.ts --open --doctor');
  const lan = runMac('start-floor-lan.command', '24.18.1');
  assert.equal(lan.status, 0, lan.stderr);
  assert.equal(lan.args, 'src/server/main.ts --lan --open --doctor');
  assert.match(lan.stdout, /신뢰할 수 있는 Wi-Fi/);
});

test('P2-7-R2 macOS 시작 파일: Node가 22.18보다 오래되면 서버를 시작하지 않고 설치 안내를 표시한다', { skip: process.platform === 'win32' }, () => {
  for (const f of MAC) {
    const r = runMac(f, '20.11.0');
    assert.equal(r.status, 1, f);
    assert.equal(r.args, '', `${f}: 서버를 시작하지 않는다`);
    assert.match(r.stdout, /20\.11\.0/);
    assert.match(r.stdout, /https:\/\/nodejs\.org/);
    assert.match(r.stdout, /22\.18 이상/);
  }
  // node가 아예 없을 때의 안내 (Finder 실행은 PATH가 짧을 수 있어 Homebrew 경로도 찾아본다)
  for (const f of MAC) {
    const none = runMac(f, null);
    assert.equal(none.status, 1, f);
    assert.match(none.stdout, /Node\.js가 없습니다\. https:\/\/nodejs\.org/);
    const s = read(f);
    assert.match(s, /command -v node/);
    assert.match(s, /\/opt\/homebrew\/bin/);
    assert.match(s, /\/opt\/homebrew\/opt\/node\*\/bin/); // keg-only node@22
    assert.match(s, /Node\.js가 없습니다/);
  }
});

test('P2-7-R2 시작 파일 4개의 Node 버전 검사식: 22.18 미만은 거부하고 22.18 이상·다음 LTS는 통과한다', () => {
  const cases: [string, number][] = [['20.11.0', 1], ['22.6.0', 1], ['22.17.9', 1], ['22.18.0', 0], ['22.23.2', 0], ['24.18.1', 0], ['26.5.1', 0]];
  for (const f of [...MAC, ...WIN]) {
    const s = read(f);
    const expr = (f.endsWith('.cmd') ? /node -e "([^"]+)"/ : / -e '([^']+)'/).exec(s)?.[1];
    assert.ok(expr, `${f}: 버전 검사식`);
    const judge = new Function('process', expr) as (p: unknown) => void;
    for (const [v, want] of cases) {
      let code: number | undefined;
      judge({ versions: { node: v }, exit: (c: number) => { code = c; } });
      assert.equal(code, want, `${f} ${v}`);
    }
  }
});

test('P2-7-R2 Windows 시작 파일: Node가 없거나 22.18보다 오래되면 서버를 시작하지 않고 설치 안내를 표시한다', () => {
  for (const name of WIN) {
    const s = read(name);
    assert.match(s, /where node/);
    assert.match(s, /Node\.js가 없습니다/);
    assert.match(s, /process\.versions\.node/);
    assert.match(s, /22\.18 이상/);
    assert.ok(s.indexOf('process.versions.node') < s.indexOf(serverLine(s)), `${name}: 버전 검사가 서버 시작보다 먼저`);
  }
});

test('P0-7-R12 macOS 시작 파일: 서버 출력(토큰 주소)을 파일이나 다른 명령으로 옮기지 않는다', () => {
  for (const name of MAC) {
    const s = read(name);
    const line = s.split('\n').find((l) => l.startsWith('node src/server/main.ts')) ?? '';
    assert.match(line, /^node src\/server\/main\.ts( --lan)? --open --doctor \|\| pause$/, name);
    assert.doesNotMatch(s, /\btee\b|\.log\b|pbcopy/i, name);
  }
});
