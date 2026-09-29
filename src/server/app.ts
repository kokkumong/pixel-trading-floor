// HTTP 서버 (node:http, 의존성 없음). 요청마다 순서대로 검사한다:
//   Host 허용 목록(P0-7-R5) → 요청 횟수(R7) → LAN 첫 접속 토큰 → 경로 표(표에 없으면 404, 기본 차단) → 접근 등급(P0-7.4) → Origin(R6) → 분석 실행 횟수(R7)
// 모든 응답에 콘텐츠 보안 정책을 붙이고(P1-7-R12), 로그와 오류 응답의 비밀값을 가린다(P1-7-R13, P0-7-R4).
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { basename, extname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoModes } from '../core/demo.ts';
import { LAN_WARNING, runDiagnostics, type DiagResult } from '../core/diag.ts';
import { createRealNet } from '../core/data/net.ts';
import { renderMarkdown } from '../core/report/markdown.ts';
import type { ReportTab } from '../core/report/report.ts';
import { listBundleFiles } from './bundle.ts';
import type { JobManager } from './jobs.ts';
import { diagnosticsPage, messagePage, page, projectZipPage, reportPage, reportsPage, type Raw } from './pages.ts';
import {
  allowedHosts, checkHost, checkOrigin, decideAccess, isLoopback, parseCookies, RATE_LIMITS, RateLimiter, redact, SESSION_COOKIE,
  type Access, type LanAuth, type ServerMode,
} from './security.ts';
import { buildZip } from './zip.ts';

export const WEB_DIR = fileURLToPath(new URL('../web/', import.meta.url));
export const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** P1-7-R12 */
export const CSP = "default-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'";
/** P1-7-R15 */
export const ALL_ZIP_MAX_BYTES = 200 * 1024 * 1024;
const MAX_BODY_BYTES = 16 * 1024;
const SSE_PING_MS = 15_000;

export interface AppOptions {
  manager: JobManager;
  mode: ServerMode;
  /** 0이면 listen 때 정해진다 */
  port: number;
  /** LAN 모드에서 서버를 켤 때 쓰는 인증 (로컬 모드는 null) */
  auth: LanAuth | null;
  lanAddrs?: string[];
  enableProjectZip?: boolean;
  lanAllowAnalyze?: boolean;
  projectRoot?: string;
  webDir?: string;
  diagnostics?: (claudeTest: boolean) => Promise<DiagResult>;
  /** 테스트용: 접속 주소 (기본: 소켓 주소) */
  clientIp?: (req: IncomingMessage) => string | undefined;
  onRotate?: () => void;
  log?: (line: string) => void;
  now?: () => number;
  allZipMaxBytes?: number;
}

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: string[];
  ip: string;
  isLocal: boolean;
}

interface Route {
  method: 'GET' | 'POST';
  path: RegExp;
  access: Access;
  /** 요청 횟수 분류 (P0-7-R7) */
  rate?: 'analyze';
  handle: (c: Ctx) => void | Promise<void>;
}

const UUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const STATIC_NAME = /^[a-z0-9-]+\.(html|js|css|svg|png|ico)$/;
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};
const TABS: readonly ReportTab[] = ['analysis', 'simulation', 'lightweight', 'demo'];

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface App {
  server: Server;
  listen(): Promise<number>;
  close(): Promise<void>;
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
}

export function createApp(o: AppOptions): App {
  const m = o.manager;
  const webDir = o.webDir ?? WEB_DIR;
  const projectRoot = o.projectRoot ?? PROJECT_ROOT;
  const home = homedir();
  const now = o.now ?? Date.now;
  const limiter = new RateLimiter(now);
  let port = o.port;
  let hosts = allowedHosts(port, o.mode, o.lanAddrs ?? []);
  const secrets = () => o.auth?.secrets() ?? [];
  const clean = (s: string) => redact(s, secrets(), home);
  const log = (s: string) => o.log?.(clean(s));
  const runDiag = o.diagnostics ?? ((claudeTest: boolean) => runDiagnostics({
    net: createRealNet(), env: process.env, claudeTest,
    dirs: [{ label: 'reports/', path: m.reports.dir }, { label: 'jobs/', path: m.jobs.root }],
    server: { port, mode: o.mode, running: true },
  }));
  /** 진단 결과의 경로에서 사용자 이름을 가린다 (P1-7-R13) */
  const diagnostics = async (claudeTest: boolean): Promise<DiagResult> => {
    const d = await runDiag(claudeTest);
    return { ...d, checks: d.checks.map((c) => ({ ...c, detail: clean(c.detail), ...(c.hint ? { hint: clean(c.hint) } : {}) })) };
  };

  const baseHeaders = (type: string): Record<string, string> => ({
    'Content-Type': type,
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer', // 토큰이 담긴 주소가 다른 곳으로 새지 않게
    'Cache-Control': 'no-store',
  });

  const send = (res: ServerResponse, status: number, type: string, body: string | Buffer, extra: Record<string, string> = {}) => {
    res.writeHead(status, { ...baseHeaders(type), ...extra });
    res.end(body);
  };
  const json = (res: ServerResponse, status: number, v: unknown) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(v));
  const lanBanner = () => (o.mode === 'lan' ? `${LAN_WARNING} · 신뢰할 수 있는 개인 네트워크에서만 쓰세요` : null);
  const htmlPage = (res: ServerResponse, status: number, title: string, body: Raw, demo = false) =>
    send(res, status, 'text/html; charset=utf-8', page(title, body, { lanBanner: lanBanner(), demo }));
  const fail = (c: Ctx, e: HttpError) => {
    if (c.url.pathname.startsWith('/api/')) json(c.res, e.status, { error: e.code, message: clean(e.message) });
    else htmlPage(c.res, e.status, e.code, messagePage(String(e.status), clean(e.message)));
  };

  async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    const type = String(req.headers['content-type'] ?? '');
    if (!type.startsWith('application/json')) throw new HttpError(415, 'E-INPUT', 'Content-Type은 application/json이어야 합니다');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY_BYTES) throw new HttpError(413, 'E-INPUT', '요청 본문이 너무 큽니다');
      chunks.push(chunk as Buffer);
    }
    try {
      const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch { /* 아래 */ }
    throw new HttpError(400, 'E-INPUT', '요청 본문은 JSON 객체여야 합니다');
  }

  function serveStatic(c: Ctx, name: string) {
    if (!STATIC_NAME.test(name)) throw new HttpError(404, 'E-NOT-FOUND', '없는 파일입니다');
    const file = join(webDir, name);
    try {
      const rel = relative(realpathSync(webDir), realpathSync(file));
      if (rel.startsWith('..') || isAbsolute(rel) || !statSync(file).isFile()) throw new Error('outside');
    } catch {
      throw new HttpError(404, 'E-NOT-FOUND', '없는 파일입니다');
    }
    send(c.res, 200, CONTENT_TYPES[extname(name)] ?? 'application/octet-stream', readFileSync(file));
  }

  function canAnalyze(isLocal: boolean): boolean {
    return decideAccess({ mode: o.mode, isLocal, authed: true, access: 'analyze', lanAllowAnalyze: o.lanAllowAnalyze === true }) === 'ok';
  }

  function sse(c: Ctx, jobId: string) {
    if (!m.view(jobId)) throw new HttpError(404, 'E-NOT-FOUND', '없는 작업입니다');
    c.res.writeHead(200, { ...baseHeaders('text/event-stream; charset=utf-8'), Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const write = (event: string, data: unknown) => c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    let closed = false;
    const ping = setInterval(() => c.res.write(': ping\n\n'), SSE_PING_MS);
    const stop = () => {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      off();
      c.res.end();
    };
    // 구독을 먼저 걸고 현재 상태를 보낸다 (사이에 끝나도 놓치지 않게)
    const off = m.subscribe(jobId, (e) => {
      write(e.type, e);
      if (e.type === 'end') stop();
    });
    c.req.on('close', stop);
    const v = m.view(jobId)!;
    write('job', { type: 'job', job: v });
    if (v.terminal && !m.running().includes(jobId)) {
      write('end', { type: 'end', state: v.state });
      stop();
    }
  }

  function reportTab(c: Ctx): ReportTab {
    const t = c.url.searchParams.get('tab') ?? 'analysis';
    const tab = TABS.find((x) => x === t);
    if (!tab) throw new HttpError(400, 'E-INPUT', `tab은 ${TABS.join(', ')} 중 하나`);
    return tab;
  }

  const routes: Route[] = [
    { method: 'GET', path: /^\/$/, access: 'read', handle: (c) => serveStatic(c, 'index.html') },
    { method: 'GET', path: /^\/web\/([^/]+)$/, access: 'read', handle: (c) => serveStatic(c, c.params[0]!) },
    { method: 'GET', path: /^\/favicon\.ico$/, access: 'read', handle: (c) => { c.res.writeHead(204, baseHeaders('image/x-icon')); c.res.end(); } },
    {
      method: 'GET', path: /^\/api\/status$/, access: 'read',
      handle: (c) => json(c.res, 200, {
        mode: o.mode,
        lan: o.mode === 'lan' ? { warning: LAN_WARNING, expiresAt: o.auth?.expiresAt.toISOString() ?? null } : null,
        client: { local: c.isLocal, canAnalyze: canAnalyze(c.isLocal), readOnly: !canAnalyze(c.isLocal) },
        running: m.running(),
        demoModes: safeDemoModes(),
        projectZip: o.enableProjectZip === true && c.isLocal,
      }),
    },
    {
      method: 'POST', path: /^\/api\/analyze$/, access: 'analyze', rate: 'analyze',
      handle: async (c) => {
        const body = await readJsonBody(c.req);
        const r = await m.start(body);
        if (r.kind === 'started') return json(c.res, r.existing ? 200 : 202, { jobId: r.jobId, existing: r.existing, job: m.view(r.jobId) });
        if (r.kind === 'busy') return json(c.res, 409, { error: 'E-BUSY', message: '실행 중인 분석이 있습니다', running: r.runningJobId ? m.view(r.runningJobId) : null });
        json(c.res, r.status, { error: r.code, message: clean(r.message), ...(r.hint ? { hint: r.hint } : {}) });
      },
    },
    {
      method: 'GET', path: new RegExp(`^/api/jobs/${UUID}$`), access: 'read',
      handle: (c) => {
        const v = m.view(c.params[0]!);
        if (!v) throw new HttpError(404, 'E-NOT-FOUND', '없는 작업입니다');
        json(c.res, 200, v);
      },
    },
    {
      method: 'GET', path: new RegExp(`^/api/jobs/${UUID}/snapshot$`), access: 'read',
      handle: (c) => {
        const s = m.snapshot(c.params[0]!);
        if (!s) throw new HttpError(404, 'E-NOT-FOUND', '스냅샷이 없습니다');
        json(c.res, 200, s);
      },
    },
    { method: 'GET', path: new RegExp(`^/api/jobs/${UUID}/events$`), access: 'read', handle: (c) => sse(c, c.params[0]!) },
    {
      method: 'POST', path: new RegExp(`^/api/jobs/${UUID}/cancel$`), access: 'analyze',
      handle: (c) => {
        const id = c.params[0]!;
        if (!m.view(id)) throw new HttpError(404, 'E-NOT-FOUND', '없는 작업입니다');
        if (!m.cancel(id)) throw new HttpError(409, 'E-NOT-RUNNING', '실행 중인 작업이 아닙니다');
        json(c.res, 202, { jobId: id, cancelling: true });
      },
    },
    {
      method: 'GET', path: /^\/api\/reports$/, access: 'read',
      handle: (c) => json(c.res, 200, { tab: reportTab(c), reports: m.reports.list(reportTab(c)).map(({ file: _f, ...r }) => ({ ...r, url: `/reports/${r.jobId}` })) }),
    },
    {
      method: 'GET', path: /^\/reports$/, access: 'read',
      handle: (c) => {
        const tab = reportTab(c);
        htmlPage(c.res, 200, '리포트', reportsPage(tab, m.reports.list(tab), c.isLocal), tab === 'demo');
      },
    },
    { method: 'GET', path: /^\/reports\/all\.zip$/, access: 'local', handle: (c) => allZip(c) },
    {
      method: 'GET', path: new RegExp(`^/reports/${UUID}(\\.md|\\.json)?$`), access: 'read',
      handle: (c) => {
        const found = m.reports.locate(c.params[0]!);
        if (!found) throw new HttpError(404, 'E-NOT-FOUND', '없는 리포트입니다');
        const ext = c.params[1];
        if (ext === '.json') {
          return send(c.res, 200, 'application/json; charset=utf-8', readFileSync(found.json), { 'Content-Disposition': `attachment; filename="${asciiName(found.json)}"` });
        }
        const md = found.md ? readFileSync(found.md, 'utf8') : renderMarkdown(found.report);
        if (ext === '.md') {
          return send(c.res, 200, 'text/markdown; charset=utf-8', md, { 'Content-Disposition': `attachment; filename="${asciiName(found.json.replace(/\.json$/, '.md'))}"` });
        }
        htmlPage(c.res, 200, found.report.displayName, reportPage(found.report, md), found.report.demo);
      },
    },
    {
      method: 'GET', path: /^\/diagnostics$/, access: 'local',
      handle: async (c) => htmlPage(c.res, 200, '진단', diagnosticsPage(await diagnostics(false), false)),
    },
    {
      method: 'POST', path: /^\/diagnostics\/claude-test$/, access: 'local',
      handle: async (c) => htmlPage(c.res, 200, '진단', diagnosticsPage(await diagnostics(true), true)),
    },
    { method: 'GET', path: /^\/api\/diagnostics$/, access: 'local', handle: async (c) => json(c.res, 200, await diagnostics(false)) },
    {
      method: 'GET', path: /^\/api\/project-zip\/files$/, access: 'local',
      handle: (c) => {
        projectZipEnabled();
        json(c.res, 200, listBundleFiles(projectRoot));
      },
    },
    {
      method: 'GET', path: /^\/project\.zip$/, access: 'local',
      handle: (c) => {
        projectZipEnabled();
        const list = listBundleFiles(projectRoot);
        const confirm = c.url.searchParams.get('confirm');
        // P1-7-R14: 포함 파일 목록을 먼저 보여주고, 확인한 목록 그대로일 때만 만든다
        if (confirm === null) return htmlPage(c.res, 200, 'project.zip', projectZipPage(list));
        if (confirm !== list.listHash) throw new HttpError(409, 'E-CHANGED', '확인한 뒤 파일 목록이 바뀌었습니다. 목록을 다시 확인하세요');
        const zip = buildZip(list.files.map((f) => ({ name: `pixel-trading-floor/${f.path}`, data: readFileSync(join(projectRoot, f.path)) })));
        send(c.res, 200, 'application/zip', zip, { 'Content-Disposition': 'attachment; filename="pixel-trading-floor.zip"' });
      },
    },
    {
      method: 'POST', path: /^\/api\/lan\/rotate$/, access: 'local',
      handle: (c) => {
        if (!o.auth) throw new HttpError(409, 'E-NOT-LAN', 'LAN 모드가 아닙니다');
        o.auth.rotate();
        o.onRotate?.();
        json(c.res, 200, { expiresAt: o.auth.expiresAt.toISOString() });
      },
    },
  ];

  function safeDemoModes(): string[] {
    try { return demoModes(); } catch { return []; }
  }

  function projectZipEnabled() {
    if (!o.enableProjectZip) throw new HttpError(404, 'E-DISABLED', 'project.zip은 비활성입니다 (서버를 --enable-project-zip으로 시작하면 이 PC에서만 열립니다)');
  }

  function allZip(c: Ctx) {
    // P1-7-R15: 기본 목록(분석 탭)만, 크기 상한
    const items = m.reports.list('analysis');
    const files: string[] = [];
    for (const r of items) {
      const found = m.reports.locate(r.jobId);
      if (!found) continue;
      files.push(found.json);
      if (found.md) files.push(found.md);
    }
    const total = files.reduce((s, f) => s + statSync(f).size, 0);
    const max = o.allZipMaxBytes ?? ALL_ZIP_MAX_BYTES;
    if (total > max) throw new HttpError(413, 'E-TOO-LARGE', `리포트 합계 ${Math.round(total / 1024 / 1024)}MB가 상한 ${Math.round(max / 1024 / 1024)}MB를 넘어 ZIP을 만들지 않습니다`);
    const zip = buildZip(files.map((f) => ({ name: `reports/${basename(f)}`, data: readFileSync(f) })));
    send(c.res, 200, 'application/zip', zip, { 'Content-Disposition': 'attachment; filename="reports.zip"' });
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const ip = (o.clientIp ? o.clientIp(req) : req.socket.remoteAddress) ?? '';
    const isLocal = isLoopback(ip);
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://floor.invalid');
    } catch {
      return send(res, 400, 'text/plain; charset=utf-8', '잘못된 요청');
    }
    const c: Ctx = { req, res, url, params: [], ip, isLocal };
    const started = now();
    try {
      // P0-7-R5
      if (!checkHost(req.headers.host, hosts)) throw new HttpError(403, 'E-HOST', '허용되지 않은 Host입니다');
      const method = req.method === 'HEAD' ? 'GET' : req.method;
      const route = routes.find((r) => r.method === method && r.path.test(url.pathname));
      // P0-7-R7: 모든 요청은 분당 120회. 분석 실행은 인증·출처 검사를 통과한 요청만 따로 분당 3회로 센다
      const tooMany = () => new HttpError(429, 'E-RATE', '요청이 너무 많습니다. 잠시 뒤 다시 시도하세요');
      if (!limiter.hit(`${ip}|other`, RATE_LIMITS.otherPerMinute)) throw tooMany();
      // P0-7-R3: LAN 첫 접속 /?t=<토큰> → 쿠키 발급 뒤 토큰 없는 주소로
      if (o.auth && url.searchParams.has('t')) {
        const t = url.searchParams.get('t') ?? '';
        url.searchParams.delete('t');
        const to = `${url.pathname}${url.search}`;
        if (isLocal) {
          res.writeHead(302, { ...baseHeaders('text/plain; charset=utf-8'), Location: to });
          return void res.end();
        }
        if (!o.auth.verifyToken(t)) throw new HttpError(401, 'E-TOKEN', '접속 주소가 만료되었거나 잘못되었습니다. 서버 창에 표시된 새 주소로 접속하세요');
        const s = o.auth.createSession();
        res.writeHead(302, {
          ...baseHeaders('text/plain; charset=utf-8'), Location: to,
          'Set-Cookie': `${SESSION_COOKIE}=${s.id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${s.maxAgeSeconds}`,
        });
        return void res.end();
      }
      if (!route) throw new HttpError(404, 'E-NOT-FOUND', '없는 경로입니다'); // 표에 없는 경로는 기본 차단
      const authed = o.auth ? o.auth.verifySession(parseCookies(req.headers.cookie)[SESSION_COOKIE]) : false;
      const access = decideAccess({ mode: o.mode, isLocal, authed, access: route.access, lanAllowAnalyze: o.lanAllowAnalyze === true });
      if (access === 401) throw new HttpError(401, 'E-TOKEN', '인증이 필요합니다. 서버 창에 표시된 접속 주소로 다시 접속하세요');
      if (access === 403) throw new HttpError(403, 'E-FORBIDDEN', route.access === 'read' ? '이 서버는 로컬 전용입니다' : 'LAN 기기에서는 보기만 할 수 있습니다. 이 기능은 서버 PC에서 쓰세요');
      // P0-7-R6
      if (method !== 'GET' && !checkOrigin(req.headers.origin, hosts)) throw new HttpError(403, 'E-ORIGIN', '허용되지 않은 출처의 요청입니다');
      if (route.rate === 'analyze' && !limiter.hit(`${ip}|analyze`, RATE_LIMITS.analyzePerMinute)) throw tooMany();
      c.params = route.path.exec(url.pathname)!.slice(1);
      await route.handle(c);
    } catch (e) {
      if (e instanceof HttpError) {
        if (!res.headersSent) fail(c, e);
      } else {
        log(`오류 ${req.method} ${req.url}: ${(e as Error).stack ?? String(e)}`);
        if (!res.headersSent) fail(c, new HttpError(500, 'E-INTERNAL', '서버 내부 오류'));
        else res.destroy();
      }
    } finally {
      // 보완안 9.1: LAN 요청 로그. 토큰·쿠키는 가린다
      if (o.mode === 'lan' && !isLocal) log(`${new Date(started).toISOString()} ${ip} ${req.method} ${req.url} → ${res.statusCode}`);
    }
  }

  const server = createServer((req, res) => void handle(req, res));
  return {
    server,
    handle,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(o.port, o.mode === 'lan' ? '0.0.0.0' : '127.0.0.1', () => {
        server.off('error', reject);
        port = (server.address() as { port: number }).port;
        hosts = allowedHosts(port, o.mode, o.lanAddrs ?? []);
        resolve(port);
      });
    }),
    close: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

/** Content-Disposition용: 파일명은 서버가 만든 것이지만 ASCII만 남긴다 */
function asciiName(file: string): string {
  return basename(file).replace(/[^A-Za-z0-9._+-]/g, '_');
}

