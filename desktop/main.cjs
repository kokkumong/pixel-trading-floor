// Phase 19 스파이크: Electron 메인 프로세스에서 서버를 직접 불러 창에 띄우고, 실측 결과를 SPIKE_OUT 파일에 쓴다.
// Phase 20에서 정식 셸로 교체한다.
const { app, BrowserWindow } = require('electron');
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
    const win = new BrowserWindow({ width: 1280, height: 800, show: process.env.SPIKE_SHOW === '1', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    await win.loadURL(started.localUrl());
    log(`window title=${win.getTitle()} url=${win.webContents.getURL().replace(/t=.*/, 't=***')}`);
    const hasDemo = await win.webContents.executeJavaScript(`document.body ? document.body.innerText.slice(0, 80).replace(/\\s+/g, ' ') : null`);
    log(`body text=${hasDemo}`);
    if (process.env.SPIKE_HOLD !== '1') { await started.shutdown(); app.quit(); }
  } catch (e) {
    log(`오류: ${e.stack || e}`);
    app.quit();
  }
});
app.on('window-all-closed', () => app.quit());
