// Phase 19 스파이크: Electron 메인 프로세스에서 서버를 직접 불러 창에 띄우고, 실측 결과를 SPIKE_OUT 파일에 쓴다.
// Phase 20에서 정식 셸로 교체한다.
const { app, BrowserWindow, ipcMain } = require('electron');
const { appendFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const out = process.env.SPIKE_OUT || join(app.getPath('temp'), 'floor-spike.log');
const log = (s) => appendFileSync(out, `${s}\n`);

app.whenReady().then(async () => {
  try {
    log(`node=${process.versions.node} electron=${process.versions.electron} packaged=${app.isPackaged}`);
    log(`GUI PATH=${process.env.PATH}`);
    const root = process.env.SPIKE_SELF_ROOT ? __dirname : join(__dirname, '..');
    const home = join(app.getPath('userData'), 'data');
    log(`userData=${app.getPath('userData')}`);
    // 서버 코드 안의 claude 탐색(findClaudeExecutable)을 그대로 불러 GUI PATH에서도 찾는지 본다
    const cli = await import(pathToFileURL(join(root, 'src/core/model/claude-cli.ts')).href);
    log(`findClaudeExecutable(GUI env)=${JSON.stringify(cli.findClaudeExecutable(process.env))}`);
    // 로그인 셸의 PATH를 빌려 오는 방법도 확인
    try {
      const shell = process.env.SHELL || '/bin/zsh';
      const p = execFileSync(shell, ['-lic', 'printf %s "$PATH"'], { timeout: 8000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      log(`login-shell PATH=${p}`);
      const e2 = { ...process.env, PATH: p };
      log(`findClaudeExecutable(login-shell PATH)=${JSON.stringify(cli.findClaudeExecutable(e2))}`);
    } catch (e) { log(`login-shell 실패: ${e.message}`); }

    const srv = await import(pathToFileURL(join(root, 'src/server/main.ts')).href);
    const started = await srv.startServer(['--port', '0'], { ...process.env, FLOOR_HOME: home }, (s) => log(`[server] ${s}`));
    if ('error' in started) throw new Error(started.error);
    log(`server port=${started.port} home=${home} exists=${existsSync(home)}`);
    const origin = new URL(started.localUrl()).origin;
    const win = new BrowserWindow({
      width: 1280, height: 800, show: process.env.SPIKE_SHOW === '1',
      webPreferences: {
        nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
        allowRunningInsecureContent: false, webviewTag: false, preload: join(__dirname, 'preload.cjs'),
      },
    });
    const wc = win.webContents;
    const events = [];

    // 수칙 6: OS 권한 요청(카메라·마이크·위치·알림·클립보드 등)은 전부 거부한다
    const ses = wc.session;
    ses.setPermissionRequestHandler((_wc, permission, cb) => { events.push(`permission-request:${permission}`); cb(false); });
    ses.setPermissionCheckHandler(() => false);
    ses.setDevicePermissionHandler(() => false);
    ses.on('will-download', (e) => { events.push('download'); e.preventDefault(); });
    // 수칙 5: 새 창은 만들지 않는다. https 주소만 기본 브라우저로 넘긴다 (스파이크는 기록만, 정식 셸은 shell.openExternal)
    wc.setWindowOpenHandler(({ url }) => {
      let u = null; try { u = new URL(url); } catch {}
      events.push(`window-open:${u && u.protocol === 'https:' ? 'external' : 'drop'}`);
      return { action: 'deny' };
    });
    // 수칙 4: 서버 origin 밖으로의 이동·리다이렉트·webview는 막는다
    const guard = (e, url) => { let ok = false; try { ok = new URL(url).origin === origin; } catch {} if (!ok) { events.push('nav-blocked'); e.preventDefault(); } };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    wc.on('will-attach-webview', (e) => e.preventDefault());
    // 수칙 3: IPC는 서버 origin의 최상위 프레임에서 온 요청만 받는다
    ipcMain.handle('floor:app-info', (e) => {
      const f = e.senderFrame;
      if (!f || f !== wc.mainFrame || new URL(f.url).origin !== origin) throw new Error('untrusted sender');
      return { version: app.getVersion(), platform: process.platform };
    });

    await win.loadURL(started.localUrl());
    log(`window title=${win.getTitle()} url=${wc.getURL().replace(/t=.*/, 't=***')}`);
    log(`webPreferences=${JSON.stringify((({ nodeIntegration, contextIsolation, sandbox, webSecurity, webviewTag }) => ({ nodeIntegration, contextIsolation, sandbox, webSecurity, webviewTag }))(wc.getLastWebPreferences()))}`);

    if (process.env.SPIKE_SECURITY === '1') {
      const probe = await wc.executeJavaScript(`(async () => {
        const r = {};
        r.node = [typeof require, typeof process, typeof module, typeof Buffer].join(',');
        r.bridgeKeys = Object.keys(window.floorDesktop || {}).join(',');
        r.noRawIpc = [typeof window.ipcRenderer, typeof window.electron, typeof window.floorDesktop.send, typeof window.floorDesktop.invoke].join(',');
        r.appInfo = JSON.stringify(await window.floorDesktop.getAppInfo());
        r.openExternalWin = String(window.open('https://example.com'));
        r.openBadWin = String(window.open('javascript:alert(1)'));
        r.media = await navigator.mediaDevices.getUserMedia({ video: true }).then(() => 'GRANTED', (e) => e.name);
        r.notif = await Notification.requestPermission();
        r.geo = await new Promise((res) => navigator.geolocation.getCurrentPosition(() => res('GRANTED'), (e) => res('denied:' + e.code), { timeout: 3000 }));
        r.clipRead = await navigator.clipboard.readText().then(() => 'GRANTED', (e) => e.name);
        return r;
      })()`);
      log(`probe=${JSON.stringify(probe)}`);
      wc.executeJavaScript(`location.assign('https://example.com/')`).catch(() => {});
      await new Promise((r) => setTimeout(r, 1200));
      log(`after external navigate url=${wc.getURL().replace(/t=.*/, 't=***')} windows=${BrowserWindow.getAllWindows().length}`);
      log(`events=${JSON.stringify(events)}`);
    }
    if (process.env.SPIKE_HOLD !== '1') { await started.shutdown(); app.quit(); }
  } catch (e) {
    log(`오류: ${e.stack || e}`);
    app.quit();
  }
});
app.on('window-all-closed', () => app.quit());
