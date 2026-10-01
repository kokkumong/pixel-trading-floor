// P4 데스크톱 셸의 판단 로직(순수 함수)과 셸 소스 검사. Electron 없이 돈다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_NAME, buildWebPreferences, dataDir, IPC_CHANNELS, isInsideHome, isSafeExternalUrl, isSameOrigin, isTrustedSender,
  LogBuffer, redactLogLine, serverArgs, serverEnv, windowOpenAction,
} from '../../src/desktop/shell.ts';
import { emptyBook } from '../../src/core/position/book.ts';
import { startServer } from '../../src/server/main.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const ORIGIN = 'http://localhost:51234';

test('P4-1-T1 서버·웹·코어·데스크톱 순수 모듈 소스에 electron 참조가 없다', () => {
  const files = ['src/server', 'src/web', 'src/core', 'src/cli', 'src/desktop'].flatMap((d) => walk(join(ROOT, d))).filter((f) => /\.(ts|js|mjs|cjs)$/.test(f));
  assert.ok(files.length > 50);
  const hits = files.filter((f) => /require\(\s*['"]electron['"]\s*\)|from\s+['"]electron['"]|import\(\s*['"]electron['"]\s*\)/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(hits, []);
  // 루트 패키지는 Electron을 모른다 (D1)
  const pkg = JSON.parse(read('package.json')) as { dependencies?: object; devDependencies?: Record<string, string> };
  assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
  assert.equal(Object.keys(pkg.devDependencies ?? {}).some((k) => k.includes('electron')), false);
});

test('P4-1-R1, P4-4-R4 서버 인자는 임시 포트뿐이고 환경에서 LAN·포트 지정을 걷어 낸다', () => {
  assert.deepEqual(serverArgs(), ['--port', '0']);
  const env = serverEnv({ PATH: '/usr/bin', FLOOR_LAN: '1', PORT: '8080', FLOOR_HOME: '/elsewhere' }, '/u/data');
  assert.equal(env.FLOOR_HOME, '/u/data');
  assert.equal(env.PATH, '/usr/bin');
  assert.equal('FLOOR_LAN' in env, false);
  assert.equal('PORT' in env, false);
});

test('P4-1-R3 앱 이름을 고정하고 메인 프로세스가 그 이름을 쓴다', () => {
  assert.equal(APP_NAME, 'PIXEL TRADING FLOOR');
  assert.ok(read('desktop/main.cjs').includes(`app.setName('${APP_NAME}')`));
});

test('P4-2-T1 FLOOR_HOME 서버는 jobs·reports·.floor를 그 폴더 안에만 쓰고 프로젝트 폴더에는 쓰지 않는다', async () => {
  const home = dataDir(mkdtempSync(join(tmpdir(), 'floor-userdata-')));
  assert.ok(home.endsWith(join('', 'data')));
  const stamp = () => ['jobs', 'reports', '.floor'].map((d) => {
    const p = join(ROOT, d);
    return existsSync(p) ? `${d}:${readdirSync(p).length}:${statSync(p).mtimeMs}` : `${d}:none`;
  }).join('|');
  const before = stamp();
  const s = await startServer(serverArgs(), serverEnv({ FLOOR_LAN: '1' }, home), () => {});
  assert.ok(!('error' in s));
  try {
    assert.equal(s.auth, null); // LAN 꺼짐
    const r = await s.manager.start({ symbol: 'BTC', mode: 'scalp', idempotencyKey: 'k-desktop-000001', demo: true });
    assert.ok('jobId' in r, JSON.stringify(r));
    await s.manager.idle();
    await s.manager.positions.put(emptyBook(new Date()));
    assert.equal(readdirSync(join(home, 'jobs')).length, 1);
    assert.ok(existsSync(join(home, 'reports')));
    assert.ok(existsSync(join(home, '.floor', 'positions.json')));
  } finally {
    await s.shutdown();
  }
  assert.equal(stamp(), before);
});

test('P4-2-T2 FLOOR_HOME 밖 경로는 열지 않는다', () => {
  const home = '/Users/a/Library/Application Support/PIXEL TRADING FLOOR/data';
  for (const ok of [home, `${home}/`, `${home}/reports`, `${home}/jobs/j1/job.json`, `${home}/reports/../jobs`]) assert.equal(isInsideHome(home, ok), true, ok);
  for (const bad of ['/Users/a', `${home}/..`, `${home}/../other`, `${home}-evil/x`, '/etc/passwd', '', 'reports', '../x', `${home}/a\0b`]) assert.equal(isInsideHome(home, bad), false, bad);
  for (const bad of [null, undefined, 3, {}]) assert.equal(isInsideHome(home, bad), false);
  assert.equal(isInsideHome('', '/x'), false);
});

test('P4-4-T1 서버 origin이 아닌 이동과 https가 아닌 새 창 요청은 모두 거부된다', () => {
  for (const ok of [`${ORIGIN}/`, `${ORIGIN}/?t=abc`, `${ORIGIN}/reports/x#y`]) assert.equal(isSameOrigin(ORIGIN, ok), true, ok);
  const bad = [
    'https://example.com/', 'http://localhost:51235/', 'https://localhost:51234/', 'http://127.0.0.1:51234/', 'http://localhost:51234@evil.com/',
    'http://localhost.evil.com:51234/', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'about:blank', 'blob:http://localhost:51234/x', '', '/reports', 'not a url',
  ];
  for (const u of bad) assert.equal(isSameOrigin(ORIGIN, u), false, u);
  for (const u of [null, undefined, 1]) assert.equal(isSameOrigin(ORIGIN, u), false);
  // 새 창: 창은 만들지 않고, https만 기본 브라우저로 넘긴다
  assert.equal(windowOpenAction('https://example.com/a'), 'external');
  for (const u of ['http://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', `${ORIGIN}/`, 'about:blank', '']) assert.equal(windowOpenAction(u), 'drop', u);
  // 메인 프로세스가 이 함수들로 막는다
  const main = read('desktop/main.cjs');
  for (const ev of ["'will-navigate'", "'will-redirect'", "'will-attach-webview'"]) assert.ok(main.includes(ev), ev);
  assert.match(main, /setWindowOpenHandler\([\s\S]{0,200}action: 'deny'/);
  assert.equal(/action:\s*'allow'/.test(main), false);
});

test('P4-4-T2 webPreferences는 P4-4-R1 값을 명시하고 패키징본은 개발자 도구를 끈다', () => {
  const p = buildWebPreferences('/app/desktop/preload.cjs', true);
  assert.deepEqual(p, {
    nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true,
    webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, devTools: false, preload: '/app/desktop/preload.cjs',
  });
  assert.equal(buildWebPreferences('/p', false).devTools, true);
  const main = read('desktop/main.cjs');
  assert.ok(main.includes('buildWebPreferences('));
  assert.equal(/nodeIntegration:\s*true|contextIsolation:\s*false|sandbox:\s*false|webSecurity:\s*false/.test(main), false);
  assert.ok(main.includes('remote-debugging-port')); // P4-4-R5: 패키징본에서 거부
});

test('P4-4-T3 openExternalSafe는 https만 통과시킨다', () => {
  for (const ok of ['https://example.com', 'https://example.com/a?b=1#c', `https://example.com/${'a'.repeat(2048 - 'https://example.com/'.length)}`]) assert.equal(isSafeExternalUrl(ok), true, ok.slice(0, 40));
  const bad = [
    'http://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'smb://host/share', 'ssh://host', 'vscode://file/x',
    '/relative/path', 'example.com', '', ' ', 'https://user:pw@example.com/', 'https://user@example.com/', `https://example.com/${'a'.repeat(2049 - 'https://example.com/'.length)}`,
    'HTTPS://', 'https://',
  ];
  for (const u of bad) assert.equal(isSafeExternalUrl(u), false, u.slice(0, 40));
  for (const u of [null, undefined, 1, {}, ['https://example.com']]) assert.equal(isSafeExternalUrl(u), false);
  // shell.openExternal을 부르는 곳은 openExternalSafe 하나다. openPath도 한 곳이다
  const src = ['desktop/main.cjs', 'desktop/preload.cjs'].map(read).join('\n');
  assert.equal(src.match(/shell\.openExternal\(/g)?.length, 1);
  assert.match(src, /function openExternalSafe\(url\) \{\s*if \(!policy\.isSafeExternalUrl\(url\)\) return false;/);
  assert.equal(src.match(/shell\.openPath\(/g)?.length, 1);
  assert.equal(/showItemInFolder/.test(src), false);
});

test('P4-4-T4 preload는 floorDesktop 하나만, 허용한 세 API만 노출하고 ipcMain.handle 채널과 같다', () => {
  const pre = read('desktop/preload.cjs');
  assert.equal(pre.match(/exposeInMainWorld\(/g)?.length, 1);
  assert.match(pre, /exposeInMainWorld\('floorDesktop', Object\.freeze\(\{/);
  const body = pre.slice(pre.indexOf('Object.freeze({'));
  const keys = [...body.matchAll(/^\s*([A-Za-z]+): \(\) => ipcRenderer\.invoke\('([^']+)'\),$/gm)].map((m) => [m[1], m[2]]);
  assert.deepEqual(Object.fromEntries(keys), IPC_CHANNELS);
  assert.deepEqual(Object.keys(IPC_CHANNELS).sort(), ['getAppInfo', 'getClaudeStatus', 'openDataFolder']);
  // ipcRenderer는 invoke(고정 채널)로만 쓰고, 그 자체나 send·on은 넘기지 않는다
  assert.equal(pre.match(/ipcRenderer\b/g)?.length, 1 + keys.length);
  assert.equal(/ipcRenderer\.(send|on|once|sendSync|postMessage)\b/.test(pre), false);
  assert.equal(/require\((?!'electron'\))/.test(pre), false);
  const main = read('desktop/main.cjs');
  const handled = [...main.matchAll(/handle\(policy\.IPC_CHANNELS\.([A-Za-z]+),/g)].map((m) => m[1]).sort();
  assert.deepEqual(handled, Object.keys(IPC_CHANNELS).sort());
  assert.equal(/ipcMain\.(on|once|handle)\(/.test(main.replace(/ipcMain\.handle\(channel,/g, '')), false);
});

test('P4-4-T5 IPC는 서버 origin의 최상위 프레임에서 온 요청만 받는다', () => {
  assert.equal(isTrustedSender({ url: `${ORIGIN}/`, isMainFrame: true }, ORIGIN), true);
  assert.equal(isTrustedSender({ url: `${ORIGIN}/`, isMainFrame: false }, ORIGIN), false);
  assert.equal(isTrustedSender({ url: 'https://example.com/', isMainFrame: true }, ORIGIN), false);
  assert.equal(isTrustedSender({ url: 'about:blank', isMainFrame: true }, ORIGIN), false);
  assert.equal(isTrustedSender(null, ORIGIN), false);
  assert.equal(isTrustedSender(undefined, ORIGIN), false);
  assert.match(read('desktop/main.cjs'), /if \(!trusted\(event\)\) throw new Error\('untrusted sender'\);/);
});

test('P4-4-T7 커스텀 URL 스킴·파일 연결을 등록하지 않는다', () => {
  const src = readdirSync(join(ROOT, 'desktop')).filter((f) => f.endsWith('.cjs')).map((f) => read(`desktop/${f}`)).join('\n');
  for (const word of ['setAsDefaultProtocolClient', "'open-url'", "'open-file'", 'registerSchemesAsPrivileged', 'protocol.handle']) assert.equal(src.includes(word), false, word);
  const pkg = JSON.parse(read('desktop/package.json')) as { build?: { protocols?: unknown[]; fileAssociations?: unknown[] } };
  assert.equal((pkg.build?.protocols ?? []).length, 0);
  assert.equal((pkg.build?.fileAssociations ?? []).length, 0);
});

test('P4-4-R3, P4-1-R6 서버 로그는 메모리에만 두고 토큰을 가린다', () => {
  assert.equal(redactLogLine('  이 PC 접속 주소: http://localhost:5/?t=abcDEF-123_x'), '  이 PC 접속 주소: http://localhost:5/?t=***');
  assert.equal(redactLogLine('http://h/?a=1&t=zzz&b=2 그리고 /?t=yyy'), 'http://h/?a=1&t=***&b=2 그리고 /?t=***');
  const b = new LogBuffer(3);
  for (const l of ['a', 'b /?t=secret', 'c', 'd']) b.push(l);
  assert.deepEqual(b.lines(), ['b /?t=***', 'c', 'd']);
  assert.equal(b.text().includes('secret'), false);
  const main = read('desktop/main.cjs');
  assert.equal(/writeFile|appendFile|createWriteStream|clipboard/.test(main), false); // 로그·주소를 파일·클립보드에 쓰지 않는다
  assert.equal(/console\.(log|error|warn)\(/.test(main), false);
});
