// 렌더러에 노출하는 API는 이 파일의 floorDesktop 하나뿐이다 (보안 수칙 3). 일반 send/invoke는 노출하지 않고, 허용한 채널마다 함수를 따로 둔다.
// 렌더러가 경로·명령 같은 값을 넘기는 인자는 없다 — 메인이 직접 정한다.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('floorDesktop', Object.freeze({
  getAppInfo: () => ipcRenderer.invoke('floor:app-info'),
}));
