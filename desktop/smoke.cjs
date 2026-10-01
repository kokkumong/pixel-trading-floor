// 개발 실행 전용 창 격리 스모크 (P4-4-T6). 패키징본에는 넣지 않고, main.cjs는 app.isPackaged가 아닐 때만 부른다.
// 실행: FLOOR_DESKTOP_SMOKE=<결과 파일> FLOOR_DESKTOP_USERDATA=<임시 폴더> <Electron> desktop
const { BrowserWindow } = require('electron');
const { existsSync, writeFileSync } = require('node:fs');

const PROBE = `(async () => {
  const r = {};
  r.node = [typeof require, typeof process, typeof module, typeof Buffer].join(',');
  r.bridgeKeys = Object.keys(window.floorDesktop || {}).sort().join(',');
  r.noRawIpc = [typeof window.ipcRenderer, typeof window.electron, typeof window.floorDesktop.send, typeof window.floorDesktop.invoke].join(',');
  r.appInfo = await window.floorDesktop.getAppInfo();
  r.claude = await window.floorDesktop.getClaudeStatus();
  r.openHttp = String(window.open('http://example.invalid/'));
  r.openScript = String(window.open('javascript:alert(1)'));
  r.media = await navigator.mediaDevices.getUserMedia({ video: true }).then(() => 'GRANTED', (e) => e.name);
  r.notification = await Notification.requestPermission();
  r.geo = await new Promise((res) => navigator.geolocation.getCurrentPosition(() => res('GRANTED'), (e) => res('denied:' + e.code), { timeout: 3000 }));
  r.clipRead = await navigator.clipboard.readText().then(() => 'GRANTED', (e) => e.name);
  r.title = document.title;
  return r;
})()`;

const mask = (url) => url.replace(/([?&]t=)[^&#]+/, '$1***');

exports.run = async ({ win, home, out }) => {
  const wc = win.webContents;
  const result = { versions: { node: process.versions.node, electron: process.versions.electron }, homeExists: existsSync(home), home };
  try {
    const p = wc.getLastWebPreferences();
    result.webPreferences = { nodeIntegration: p.nodeIntegration, contextIsolation: p.contextIsolation, sandbox: p.sandbox, webSecurity: p.webSecurity, webviewTag: p.webviewTag };
    result.probe = await wc.executeJavaScript(PROBE);
    const before = mask(wc.getURL());
    wc.executeJavaScript(`location.assign('https://example.invalid/')`).catch(() => {});
    await new Promise((r) => setTimeout(r, 1200));
    result.urlBefore = before;
    result.urlAfterExternalNavigate = mask(wc.getURL());
    result.windows = BrowserWindow.getAllWindows().length;
  } catch (e) {
    result.error = String((e && e.stack) || e);
  }
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
};
