// 서버 시작: node src/server/main.ts [--lan] [--port N] [--enable-project-zip] [--lan-allow-analyze]  (npm start)
// 순서: 시작 정리(중단 작업·리포트 수리·임시 파일, P1-1-R5·P1-6-R7) → 바인딩(로컬 127.0.0.1 / LAN 0.0.0.0) → 안내 출력.
// 서버 창에서 r + Enter: LAN 토큰 재발급(P0-7-R2), q + Enter 또는 Ctrl+C: 실행 중 분석을 취소하고 종료.
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { LAN_WARNING } from '../core/diag.ts';
import { createApp, PROJECT_ROOT, type App } from './app.ts';
import { JobManager } from './jobs.ts';
import { parseServerOptions } from './options.ts';
import { LanAuth, lanIPv4Addresses, redact } from './security.ts';

export interface StartedServer {
  app: App;
  manager: JobManager;
  port: number;
  auth: LanAuth | null;
  /** LAN 토큰 재발급과 새 주소 표시 (서버 창 r + Enter) */
  rotate(): void;
  shutdown(): Promise<void>;
}

export async function startServer(argv: string[], env: NodeJS.ProcessEnv, out: (s: string) => void): Promise<StartedServer | { error: string; code: number }> {
  const opts = parseServerOptions(argv, env);
  if ('error' in opts) return { error: opts.error, code: 2 };
  const root = env.FLOOR_HOME ? resolve(env.FLOOR_HOME) : PROJECT_ROOT;
  const auth = opts.mode === 'lan' ? new LanAuth() : null;
  const log = (s: string) => out(redact(s, auth?.secrets() ?? []));
  const manager = new JobManager({ root, env, log });

  const r = manager.recover();
  if (r.interrupted.length) log(`중단된 분석 ${r.interrupted.length}건을 INTERRUPTED로 정리했습니다`);
  if (r.repaired.length) log(`Markdown이 없던 리포트 ${r.repaired.length}건을 다시 만들었습니다`);
  if (r.cleaned.length) log(`오래된 임시 파일 ${r.cleaned.length}개를 지웠습니다`);

  const lanAddrs = opts.mode === 'lan' ? lanIPv4Addresses() : [];
  let port = opts.port;
  const printLan = () => {
    if (!auth) return;
    // P0-7-R4: 토큰은 시작(재발급) 때 서버 창에 한 번만 표시한다
    out(`  다른 기기 접속 주소 (${auth.expiresAt.toLocaleTimeString()}까지 유효):`);
    for (const a of lanAddrs) out(`    http://${a}:${port}/?t=${auth.token}`);
    if (lanAddrs.length === 0) out('    (LAN IPv4 주소를 찾지 못함: 네트워크 연결을 확인하세요)');
    out('  r + Enter: 접속 주소 재발급 (기존 주소·쿠키 모두 무효)');
  };
  const app = createApp({
    manager, mode: opts.mode, port, auth, lanAddrs, enableProjectZip: opts.enableProjectZip, lanAllowAnalyze: opts.lanAllowAnalyze, log,
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

  out(`PIXEL TRADING FLOOR · 분석 시뮬레이션 (실제 주문 없음)`);
  out(`  이 PC: http://localhost:${port}   데모: http://localhost:${port}/?demo=1   리포트: http://localhost:${port}/reports   진단: http://localhost:${port}/diagnostics`);
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
  return { app, manager, port, auth, rotate, shutdown };
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
      else if (cmd === 'q') {
        rl.close();
        stop();
      }
    });
  }
}
