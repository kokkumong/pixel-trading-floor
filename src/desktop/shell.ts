// P4 데스크톱 셸의 판단 로직. Electron을 import하지 않는 순수 모듈이라 루트 테스트로 검증한다 (P4-1-R2).
// desktop/main.cjs가 import()로 불러 쓴다. 창·메뉴·대화상자 같은 Electron 호출은 main.cjs에만 있다.
import { isAbsolute, join, relative, resolve } from 'node:path';

/** P4-1-R3: 저장 폴더·창 제목·독 이름 */
export const APP_NAME = 'PIXEL TRADING FLOOR';

/** P4-4-R7: 렌더러에 여는 API와 IPC 채널. preload.cjs·main.cjs와 같아야 한다 (P4-4-T4) */
export const IPC_CHANNELS = {
  getAppInfo: 'floor:app-info',
  openDataFolder: 'floor:open-data-folder',
  getClaudeStatus: 'floor:claude-status',
} as const;

/** P4-2-R1: Electron이 userData에 캐시·쿠키를 함께 쓰므로 데이터는 data/로 분리한다 */
export function dataDir(userData: string): string {
  return join(userData, 'data');
}

/** P4-1-R1, P4-4-R4: 임시 포트, LAN 없음 */
export function serverArgs(): string[] {
  return ['--port', '0'];
}

/** 서버에 넘길 환경. FLOOR_HOME을 앱 데이터 폴더로 고정하고 LAN·포트 지정은 걷어 낸다 (P4-4-R4) */
export function serverEnv(env: NodeJS.ProcessEnv, home: string): NodeJS.ProcessEnv {
  const { FLOOR_LAN: _lan, PORT: _port, ...rest } = env;
  return { ...rest, FLOOR_HOME: home };
}

/** P4-2-R4: shell.openPath에 넘길 경로가 FLOOR_HOME 자신이거나 그 하위인가 */
export function isInsideHome(home: string, target: unknown): boolean {
  if (typeof target !== 'string' || !home || !isAbsolute(home) || !isAbsolute(target) || target.includes('\0')) return false;
  const rel = relative(resolve(home), resolve(target));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function parse(url: unknown): URL | null {
  if (typeof url !== 'string') return null;
  try { return new URL(url); } catch { return null; }
}

/** P4-4-R2: 창이 머물 수 있는 주소는 서버 origin뿐이다 */
export function isSameOrigin(origin: string, url: unknown): boolean {
  const u = parse(url);
  return u !== null && (u.protocol === 'http:' || u.protocol === 'https:') && u.origin === origin;
}

const MAX_EXTERNAL_URL = 2048;

/** P4-4-R10: 기본 브라우저로 넘겨도 되는 주소. https만, 자격 증명 없음, 2,048자 이하 */
export function isSafeExternalUrl(url: unknown): boolean {
  if (typeof url !== 'string' || url.length > MAX_EXTERNAL_URL) return false;
  const u = parse(url);
  return u !== null && u.protocol === 'https:' && u.hostname !== '' && u.username === '' && u.password === '';
}

/** P4-4-R2: 새 창은 만들지 않는다. https 주소만 기본 브라우저로 넘기고 나머지는 버린다 */
export function windowOpenAction(url: unknown): 'external' | 'drop' {
  return isSafeExternalUrl(url) ? 'external' : 'drop';
}

export interface ShellWebPreferences {
  nodeIntegration: false;
  nodeIntegrationInWorker: false;
  nodeIntegrationInSubFrames: false;
  contextIsolation: true;
  sandbox: true;
  webSecurity: true;
  allowRunningInsecureContent: false;
  webviewTag: false;
  devTools: boolean;
  preload: string;
}

/** P4-4-R1: 기본값에 기대지 않고 명시한다. 패키징본은 개발자 도구를 끈다 (P4-4-R5) */
export function buildWebPreferences(preload: string, packaged: boolean): ShellWebPreferences {
  return {
    nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true,
    webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, devTools: !packaged, preload,
  };
}

/** P4-4-R8: IPC 발신이 창의 최상위 프레임이고 서버 origin인가 */
export function isTrustedSender(sender: { url: string; isMainFrame: boolean } | null | undefined, origin: string): boolean {
  return !!sender && sender.isMainFrame === true && isSameOrigin(origin, sender.url);
}

/** P4-4-R3: 접속 토큰(`?t=`)을 가린다. 서버는 시작할 때 토큰 주소를 한 번 출력한다 */
export function redactLogLine(line: string): string {
  return line.replace(/([?&]t=)[^\s&#]+/g, '$1***');
}

/** P4-1-R6: 서버 출력은 메모리에만 둔다 (최근 max줄). 파일로 남기지 않는다 */
export class LogBuffer {
  private readonly max: number;
  private readonly buf: string[] = [];
  constructor(max = 200) {
    this.max = max;
  }
  push(line: string): void {
    this.buf.push(redactLogLine(line));
    if (this.buf.length > this.max) this.buf.splice(0, this.buf.length - this.max);
  }
  lines(): string[] {
    return [...this.buf];
  }
  text(): string {
    return this.buf.join('\n');
  }
}
