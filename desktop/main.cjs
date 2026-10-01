// PIXEL TRADING FLOOR 데스크톱 셸 — Electron 메인 프로세스 (P4 명세 1·2·4장).
// 서버를 앱 안에서 켜고 그 주소를 창 하나에 띄운다. 서버·웹·코어는 Electron을 모른다.
// 판단 로직(주소 허용·경로 검사·창 설정·발신 검사)은 src/desktop/shell.ts(순수 모듈)에 있고 루트 테스트가 검증한다.
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

app.setName('PIXEL TRADING FLOOR'); // P4-1-R3. userData 경로가 이 이름을 쓰므로 가장 먼저 부른다

const ROOT = join(__dirname, '..');
const load = (rel) => import(pathToFileURL(join(ROOT, rel)).href);
const DEV = !app.isPackaged;

let policy = null; // src/desktop/shell.ts
let started = null; // StartedServer
let win = null;
let origin = ''; // 서버 origin. 창은 이 밖으로 나가지 않는다
let home = ''; // FLOOR_HOME
let logs = null;
let claudeFound = false;
let closeConfirmed = false;
let stopped = false;

// P4-4-R10: shell.openExternal을 부르는 곳은 여기 하나다
function openExternalSafe(url) {
  if (!policy.isSafeExternalUrl(url)) return false;
  void shell.openExternal(url);
  return true;
}

// P4-2-R4: 메인이 만든 FLOOR_HOME 하위 경로만 연다. 렌더러가 준 값은 넘기지 않는다
async function openInHome(target) {
  if (!policy.isInsideHome(home, target)) return false;
  return (await shell.openPath(target)) === '';
}

// P4-4-R2: 서버 origin 밖 이동·webview·새 창을 막는다. 앱이 만드는 모든 webContents에 건다
function harden(contents) {
  const guard = (event, url) => {
    if (!policy || !policy.isSameOrigin(origin, url)) event.preventDefault();
  };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.on('will-frame-navigate', (event) => guard(event, event.url));
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (policy) openExternalSafe(url);
    return { action: 'deny' };
  });
}

// P4-4-R9: OS 권한 요청은 모두 거부하고 다운로드는 취소한다
function denyPermissions(ses) {
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.on('will-download', (event) => event.preventDefault());
}

// P4-4-R8: 창의 최상위 프레임이고 서버 origin일 때만 처리한다
function trusted(event) {
  const frame = event.senderFrame;
  const sender = frame && win ? { url: frame.url, isMainFrame: frame === win.webContents.mainFrame } : null;
  return policy.isTrustedSender(sender, origin);
}

// P4-4-R7: 렌더러에 여는 API는 세 개다. 인자를 받지 않는다
function registerIpc() {
  const handle = (channel, fn) => ipcMain.handle(channel, (event) => {
    if (!trusted(event)) throw new Error('untrusted sender');
    return fn();
  });
  handle(policy.IPC_CHANNELS.getAppInfo, () => ({ name: app.getName(), version: app.getVersion(), platform: process.platform, packaged: app.isPackaged }));
  handle(policy.IPC_CHANNELS.openDataFolder, () => openInHome(home));
  handle(policy.IPC_CHANNELS.getClaudeStatus, () => ({ found: claudeFound }));
}

// P4-1-R6: 서버 출력은 메모리에만 있다 (토큰은 LogBuffer가 가린다)
function showLogs() {
  const lines = logs ? logs.lines().slice(-40) : [];
  void dialog.showMessageBox(win ?? undefined, {
    type: 'info', buttons: ['닫기'], message: '서버 로그 (최근 40줄, 파일로 저장하지 않습니다)', detail: lines.length ? lines.join('\n') : '(출력 없음)',
  });
}

// P4-1-R7: 맥에서 복사·붙여넣기·실행 취소가 되려면 편집 메뉴가 있어야 한다
function buildMenu() {
  const view = [{ role: 'reload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }];
  if (DEV) view.push({ type: 'separator' }, { role: 'toggleDevTools' }); // P4-4-R5: 패키징본에는 없다
  return Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    { label: '보기', submenu: view },
    { role: 'windowMenu' },
    { role: 'help', label: '도움말', submenu: [
      { label: '서버 로그 보기', click: showLogs },
      { label: '데이터 폴더 열기', click: () => { void openInHome(home); } },
    ] },
  ]);
}

// P4-1-R5: 실행 중인 분석이 있으면 닫기 전에 확인을 받는다
function onClose(event) {
  if (closeConfirmed || !started || started.manager.running().length === 0) return;
  event.preventDefault();
  void dialog.showMessageBox(win, {
    type: 'warning', buttons: ['분석 취소하고 닫기', '계속 실행'], defaultId: 1, cancelId: 1,
    message: '분석이 취소됩니다', detail: '창을 닫으면 실행 중인 분석이 취소됩니다. 닫을까요?',
  }).then(({ response }) => {
    if (response !== 0 || !win) return;
    closeConfirmed = true;
    win.close();
  });
}

async function openWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600, show: false, title: app.getName(), backgroundColor: '#0f0f1a',
    webPreferences: policy.buildWebPreferences(join(__dirname, 'preload.cjs'), app.isPackaged),
  });
  denyPermissions(win.webContents.session);
  win.once('ready-to-show', () => win && win.show());
  win.on('close', onClose);
  win.on('closed', () => { win = null; });
  // P4-4-R3: 토큰 주소로 한 번 열어 쿠키를 받는다. 이 주소는 어디에도 남기지 않는다
  await win.loadURL(started.localUrl());
}

async function boot() {
  try {
    policy = await load('src/desktop/shell.ts');
    logs = new policy.LogBuffer();
    home = policy.dataDir(app.getPath('userData')); // P4-2-R1
    mkdirSync(home, { recursive: true });
    const env = policy.serverEnv(process.env, home);
    const server = await load('src/server/main.ts');
    const result = await server.startServer(policy.serverArgs(), env, (line) => logs.push(line));
    if ('error' in result) throw new Error(result.error);
    started = result;
    origin = new URL(started.localUrl()).origin;
    // Phase 21이 탐색 확장·안내로 바꾼다 (P4-3). 지금은 기존 탐색 결과만 알려 준다
    const cli = await load('src/core/model/claude-cli.ts');
    claudeFound = cli.findClaudeExecutable(env) !== null;
    registerIpc();
    Menu.setApplicationMenu(buildMenu());
    await openWindow();
    if (DEV && process.env.FLOOR_DESKTOP_SMOKE) {
      await require('./smoke.cjs').run({ win, home, out: process.env.FLOOR_DESKTOP_SMOKE });
      app.quit();
    }
  } catch (e) {
    const message = String((e && e.message) || e);
    dialog.showErrorBox(app.getName(), `앱을 시작하지 못했습니다.\n${policy ? policy.redactLogLine(message) : '프로그램 파일을 읽지 못했습니다. 다시 설치해 주세요.'}`);
    app.quit();
  }
}

function main() {
  // P4-4-R5: 패키징본은 원격 디버깅 포트를 받지 않는다 (fuses는 Phase 22)
  if (!DEV && (app.commandLine.hasSwitch('remote-debugging-port') || app.commandLine.hasSwitch('remote-debugging-pipe'))) {
    app.exit(1);
    return;
  }
  // 개발 실행에서만: 스모크가 실제 데이터 폴더를 건드리지 않도록 userData를 바꿀 수 있다
  if (DEV && process.env.FLOOR_DESKTOP_USERDATA) app.setPath('userData', process.env.FLOOR_DESKTOP_USERDATA);
  // P4-1-R4: 이미 실행 중이면 기존 창을 앞으로 가져오고 끝낸다
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.on('web-contents-created', (_event, contents) => harden(contents));
  // P4-1-R5: 창이 모두 닫히면 맥에서도 끝낸다. 끝내기 전에 서버를 정리한다 (실행 중 분석 취소 포함)
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', (event) => {
    if (stopped || !started) return;
    event.preventDefault();
    stopped = true;
    // 여기서 app.quit()을 다시 부르면 끝나지 않는다 (Electron 44 실측). 정리가 끝났으므로 바로 끝낸다
    started.shutdown().catch(() => {}).finally(() => app.exit(0));
  });
  void app.whenReady().then(boot);
}

main();
