// 서버 시작: node src/server/main.ts [--lan] [--port N] [--enable-project-zip] [--lan-allow-analyze] [--open] [--doctor]  (npm start)
// 순서: 시작 정리(중단 작업·리포트 수리·임시 파일, P1-1-R5·P1-6-R7) → 바인딩(로컬 127.0.0.1 / LAN 0.0.0.0) → 안내 출력.
// 이 PC 접속도 로컬 토큰 주소(/?t=)로 연다. 토큰은 서버 창에 한 번만 표시하고 파일로 남기지 않는다. --open은 그 주소로 기본 브라우저를 연다.
// --doctor는 시작 전에 Node·Claude 점검 요약을 쓴다 (시작 파일 start-floor.command·.cmd, P2-7-R2). 부족해도 서버는 켠다 (데모·리포트 보기).
// 서버 창에서 l + Enter: 로컬 토큰 재발급, r + Enter: LAN 토큰 재발급(P0-7-R2), q + Enter 또는 Ctrl+C: 실행 중 분석을 취소하고 종료.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { formatStartupDoctor, LAN_WARNING, startupDoctor, type Check } from '../core/diag.ts';
import { createApp, PROJECT_ROOT, type App } from './app.ts';
import { JobManager } from './jobs.ts';
import { parseServerOptions } from './options.ts';
import { isPrivateIPv4, LanAuth, lanIPv4Addresses, redact } from './security.ts';

export interface StartedServer {
  app: App;
  manager: JobManager;
  port: number;
  auth: LanAuth | null;
  localAuth: LanAuth;
  /** 로컬 토큰이 든 이 PC 접속 주소 */
  localUrl(): string;
  /** LAN 토큰 재발급과 새 주소 표시 (서버 창 r + Enter) */
  rotate(): void;
  /** 로컬 토큰 재발급과 새 주소 표시 (서버 창 l + Enter). 이 PC의 기존 쿠키가 모두 무효가 된다 */
  rotateLocal(): void;
  shutdown(): Promise<void>;
}

export interface StartDeps {
  /** 이 PC의 IPv4 주소 (테스트용, 기본: 네트워크 인터페이스) */
  interfaces?: () => string[];
  /** --open의 브라우저 열기 (테스트용, 기본: openBrowser) */
  openBrowser?: (url: string) => void;
  /** --doctor의 시작 점검 (테스트용, 기본: startupDoctor) */
  doctor?: () => Promise<Check[]>;
}

/** 기본 브라우저로 주소를 연다. 셸 없이 인자 배열로 실행한다 (주소가 명령으로 해석되지 않게) */
export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): void {
  const [cmd, args] = platform === 'darwin' ? ['open', [url]]
    : platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : ['xdg-open', [url]];
  const child = spawn(cmd, args as string[], { stdio: 'ignore', detached: true, shell: false });
  child.on('error', () => {});
  child.unref();
}

export async function startServer(argv: string[], env: NodeJS.ProcessEnv, out: (s: string) => void, deps: StartDeps = {}): Promise<StartedServer | { error: string; code: number }> {
  const opts = parseServerOptions(argv, env);
  if ('error' in opts) return { error: opts.error, code: 2 };
  // P0-7.1: LAN 공유는 사설 네트워크 주소로만. 공인 IP·VPN(CGNAT 100.64/10 등)으로는 접속을 받지 않는다
  const all = opts.mode === 'lan' ? (deps.interfaces ?? lanIPv4Addresses)() : [];
  const lanAddrs = all.filter(isPrivateIPv4);
  const ignored = all.filter((a) => !isPrivateIPv4(a));
  if (opts.mode === 'lan' && lanAddrs.length === 0) {
    return { error: `사설 네트워크 주소(192.168.x.x, 10.x.x.x, 172.16~31.x.x)를 찾지 못해 LAN 모드를 시작하지 않습니다${ignored.length ? ` (사설이 아닌 주소: ${ignored.join(', ')})` : ''}`, code: 1 };
  }
  if (opts.doctor) {
    // 접속 주소가 창 아래쪽에 남도록 점검 요약을 먼저 쓴다
    for (const line of formatStartupDoctor(await (deps.doctor ?? (() => startupDoctor({ env })))())) out(line);
    out('');
  }
  const root = env.FLOOR_HOME ? resolve(env.FLOOR_HOME) : PROJECT_ROOT;
  const auth = opts.mode === 'lan' ? new LanAuth() : null;
  const localAuth = new LanAuth({ ttlMs: null }); // 서버 실행 동안 유효
  const log = (s: string) => out(redact(s, [...localAuth.secrets(), ...(auth?.secrets() ?? [])]));
  const manager = new JobManager({ root, env, log });

  const r = manager.recover();
  if (r.interrupted.length) log(`중단된 분석 ${r.interrupted.length}건을 INTERRUPTED로 정리했습니다`);
  if (r.repaired.length) log(`Markdown이 없던 리포트 ${r.repaired.length}건을 다시 만들었습니다`);
  if (r.cleaned.length) log(`오래된 임시 파일 ${r.cleaned.length}개를 지웠습니다`);

  let port = opts.port;
  const printLan = () => {
    if (!auth) return;
    // P0-7-R4: 토큰은 시작(재발급) 때 서버 창에 한 번만 표시한다
    out(`  다른 기기 접속 주소 (${auth.expiresAt.toLocaleTimeString()}까지 유효):`);
    for (const a of lanAddrs) out(`    http://${a}:${port}/?t=${auth.token}`);
    if (ignored.length) out(`  사설 네트워크가 아닌 주소로는 접속을 받지 않습니다: ${ignored.join(', ')}`);
    out('  r + Enter: 접속 주소 재발급 (기존 주소·쿠키 모두 무효)');
  };
  const localUrl = () => `http://localhost:${port}/?t=${localAuth.token}`;
  const printLocal = () => {
    // 토큰은 이 줄에만 나온다. 다시 보려면 l + Enter로 재발급한다
    out(`  이 PC 접속 주소 (서버를 끌 때까지 유효): ${localUrl()}`);
  };
  const app = createApp({
    manager, mode: opts.mode, port, auth, localAuth, lanAddrs, enableProjectZip: opts.enableProjectZip, lanAllowAnalyze: opts.lanAllowAnalyze, log,
    onRotate: () => {
      out('LAN 접속 토큰을 재발급했습니다.');
      printLan();
    },
  });
  try {
    port = await app.listen();
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE') return { error: `포트 ${opts.port}이(가) 이미 사용 중입니다. 먼저 켜져 있던 서버 창을 닫거나 PORT 환경변수로 포트를 바꾸세요`, code: 1 };
    throw e;
  }

  out(`PIXEL TRADING FLOOR · 분석 도구 (실제 주문 기능 없음)`);
  printLocal();
  out(`  이 주소로 한 번 열면 브라우저에 접속 쿠키가 생깁니다. 그 뒤로는 http://localhost:${port}   데모: http://localhost:${port}/?demo=1   리포트: http://localhost:${port}/reports   진단: http://localhost:${port}/diagnostics`);
  out('  l + Enter: 이 PC 접속 주소 재발급 (이 PC 브라우저의 기존 접속 모두 무효)');
  if (opts.mode === 'lan') {
    out(`⚠ ${LAN_WARNING} — 토큰은 무단 접근을 막지만 도청은 막지 못합니다. 신뢰할 수 있는 개인 네트워크에서만 쓰세요 (공용·게스트 Wi-Fi 금지)`);
    out('  다른 기기는 보기만 할 수 있습니다 (분석 실행, ZIP 다운로드, 진단은 이 PC에서).');
    if (opts.lanAllowAnalyze) out('⚠ --lan-allow-analyze: 다른 기기도 분석을 실행할 수 있습니다. 토큰을 가로챈 사람이 이 PC의 Claude 사용량을 쓸 수 있습니다');
    printLan();
  } else {
    out('  로컬 전용 (127.0.0.1): 다른 기기에서는 접속할 수 없습니다. 공유하려면 --lan');
  }
  if (opts.enableProjectZip) out(`  project.zip 활성 (이 PC에서만): http://localhost:${port}/project.zip`);
  out('  종료: Ctrl+C');

  let closing: Promise<void> | null = null;
  const shutdown = () => (closing ??= (async () => {
    manager.cancelAll();
    await Promise.race([manager.idle(), new Promise((r) => setTimeout(r, 5000))]);
    await app.close();
  })());
  const rotate = () => {
    if (!auth) return;
    auth.rotate();
    out('LAN 접속 토큰을 재발급했습니다.');
    printLan();
  };
  const rotateLocal = () => {
    localAuth.rotate();
    out('이 PC 접속 토큰을 재발급했습니다.');
    printLocal();
  };
  if (opts.open) (deps.openBrowser ?? openBrowser)(localUrl());
  return { app, manager, port, auth, localAuth, localUrl, rotate, rotateLocal, shutdown };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = (s: string) => process.stdout.write(`${s}\n`);
  const started = await startServer(process.argv.slice(2), process.env, out);
  if ('error' in started) {
    process.stderr.write(`${started.error}\n`);
    process.exit(started.code);
  }
  const stop = () => {
    out('종료 중: 실행 중인 분석을 취소합니다...');
    void started.shutdown().then(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin });
    rl.on('line', (line) => {
      const cmd = line.trim().toLowerCase();
      if (cmd === 'r') started.rotate();
      else if (cmd === 'l') started.rotateLocal();
      else if (cmd === 'q') {
        rl.close();
        stop();
      }
    });
  }
}
