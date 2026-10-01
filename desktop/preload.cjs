// 렌더러에 노출하는 API는 floorDesktop 하나, 함수 세 개뿐이다 (P4-4-R7).
// 일반 send/invoke는 노출하지 않고, 허용한 채널마다 함수를 따로 둔다. 렌더러가 경로·주소·명령을 넘기는 인자는 없다 — 메인이 직접 정한다.
// 채널 이름은 src/desktop/shell.ts의 IPC_CHANNELS와 같아야 한다 (P4-4-T4가 검사한다). 새 API는 명세를 먼저 고친다.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('floorDesktop', Object.freeze({
  getAppInfo: () => ipcRenderer.invoke('floor:app-info'),
  openDataFolder: () => ipcRenderer.invoke('floor:open-data-folder'),
  getClaudeStatus: () => ipcRenderer.invoke('floor:claude-status'),
}));
