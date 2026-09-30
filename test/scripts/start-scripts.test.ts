import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name: string) => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');
/** 서버를 띄우는 줄 */
const serverLine = (text: string) => text.split(/\r\n/).find((l) => /src\\server\\main\.ts/.test(l)) ?? '';

test('P0-7.6 · P0-7-R12 start-floor.cmd: 로컬 전용으로 --open 시작, 서버 출력을 파일로 남기지 않는다', () => {
  const s = read('start-floor.cmd');
  const line = serverLine(s);
  assert.match(line, /^node src\\server\\main\.ts --open$/);
  assert.doesNotMatch(s, /--lan/);
});

test('P0-7.6 start-floor-lan.cmd: --lan --open 시작, 신뢰 네트워크·읽기 전용·2시간 안내, 출력을 파일로 남기지 않는다', () => {
  const s = read('start-floor-lan.cmd');
  assert.match(serverLine(s), /^node src\\server\\main\.ts --lan --open$/);
  assert.match(s, /공용/);
  assert.match(s, /읽기 전용/);
  assert.match(s, /2시간/);
});

test('P0-7.6 시작 스크립트 공통: CRLF, UTF-8 코드 페이지, 스크립트 폴더에서 실행, 리다이렉트·로그 파일 없음', () => {
  for (const name of ['start-floor.cmd', 'start-floor-lan.cmd']) {
    const s = read(name);
    assert.equal(s.split('\n').length, s.split('\r\n').length, `${name} CRLF`);
    assert.match(s, /^chcp 65001 ?>nul$/m, name);
    assert.match(s, /^cd \/d "%~dp0"$/m, name);
    // 토큰 주소가 서버 창에 찍히므로 서버 출력은 어디에도 옮기지 않는다 (>nul로 버리는 준비 명령만 허용)
    const redirects = s.split('\r\n').filter((l) => !/^\s*rem /i.test(l)).flatMap((l) => l.match(/\d?>>?\s*(?!nul\b)\S+|\|\s*\S+/gi) ?? []);
    assert.deepEqual(redirects.filter((r) => !/^\d?>&\d|^\|\|/.test(r)), [], name);
    assert.doesNotMatch(s, /\btee\b|\.log\b|Out-File|clip\b/i, name);
    assert.doesNotMatch(serverLine(s), /[>|]/, name);
  }
});
