// HTTP 서버의 보안 경계 (P0 명세 7장, P1 명세 7.5). 네트워크를 쓰지 않는 순수한 부품만 둔다.
// 로컬 전용(기본): 127.0.0.1 바인딩, 시작마다 새 로컬 토큰(서버 실행 동안 유효). LAN 공유(--lan): 0.0.0.0 바인딩, 로컬 토큰 + 2시간 LAN 토큰, 다른 기기는 읽기 전용.
// 루프백 접속도 로컬 토큰으로 받은 세션 쿠키가 있어야 한다: 같은 PC의 다른 프로세스·사용자와 다른 사이트를 막는다 (이슈 #11).
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';

export type ServerMode = 'local' | 'lan';

/** P0-7-R2: 토큰과 세션 쿠키의 수명 */
export const LAN_TOKEN_TTL_MS = 2 * 3600_000;
export const SESSION_COOKIE = 'floor_lan';
/** 로컬 토큰 세션 쿠키. LAN 세션과 따로 두어 LAN 토큰 재발급이 서버 PC 브라우저를 로그아웃시키지 않는다 */
export const LOCAL_SESSION_COOKIE = 'floor_local';
/** 세션 표 상한. 넘으면 가장 오래된 세션부터 버린다 */
export const MAX_LAN_SESSIONS = 200;
/** P0-7-R7: IP당 1분 요청 수 */
export const RATE_LIMITS = { analyzePerMinute: 3, otherPerMinute: 120, windowMs: 60_000 } as const;

/**
 * 경로별 접근 등급 (P0-7.4 표):
 * public = 인증 없이 (화면의 정적 파일: 401 안내 페이지도 스타일을 읽게. 비밀이 없는 공개 코드)
 * read = LAN 토큰 인증 기기도 허용 (화면, 작업 진행, 리포트 목록·열람)
 * analyze = 분석 실행·취소. LAN 기기는 --lan-allow-analyze일 때만
 * local = 서버 PC에서만 (all.zip, project.zip, 진단, 토큰 재발급)
 */
export type Access = 'public' | 'read' | 'analyze' | 'local';

export function isLoopback(addr: string | undefined): boolean {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/** 사설 대역 (10/8, 172.16/12, 192.168/16). CGNAT(100.64/10, Tailscale 등 VPN)·공인·링크 로컬은 아니다 */
export function isPrivateIPv4(addr: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** 이 PC의 비루프백 IPv4 주소 전체 (사설 여부는 isPrivateIPv4로 고른다) */
export function lanIPv4Addresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

/**
 * 연결 수준 검사: 소켓이 들어온 이 PC의 주소(localAddress). LAN 모드는 0.0.0.0에 바인딩하므로
 * VPN·공인 인터페이스로 들어온 연결을 여기서 끊는다 (고른 사설 주소와 루프백만)
 */
export function allowedLocalAddress(localAddress: string | undefined, mode: ServerMode, lanAddrs: readonly string[]): boolean {
  if (!localAddress) return false;
  if (isLoopback(localAddress)) return true;
  if (mode !== 'lan') return false;
  const v4 = localAddress.startsWith('::ffff:') ? localAddress.slice('::ffff:'.length) : localAddress;
  return lanAddrs.includes(v4);
}

/**
 * P0-7-R10: 다른 사이트가 사용자 브라우저를 통해 보내는 요청 차단 (Sec-Fetch-Site).
 * Host는 정상 값(localhost:8000)으로 오므로 Host 검사로는 막히지 않는다. GET이라도 ZIP 생성·진단(외부 요청, claude 실행)·요청 한도 소진 같은 부작용이 있다.
 * 헤더가 없으면(브라우저가 아닌 클라이언트) 허용. 교차·같은 사이트(다른 포트 포함)는 / 로의 최상위 페이지 이동만 허용한다
 */
export function checkFetchSite(headers: Record<string, string | string[] | undefined>, method: string, pathname: string): boolean {
  const site = headers['sec-fetch-site'];
  if (site === undefined || site === 'same-origin' || site === 'none') return true;
  return method === 'GET' && pathname === '/' && headers['sec-fetch-mode'] === 'navigate' && headers['sec-fetch-dest'] === 'document';
}

/** P0-7-R5: DNS 리바인딩 방지용 Host 허용 목록 */
export function allowedHosts(port: number, mode: ServerMode, lanAddrs: string[]): Set<string> {
  const hosts = [`localhost:${port}`, `127.0.0.1:${port}`];
  if (mode === 'lan') hosts.push(...lanAddrs.map((a) => `${a}:${port}`));
  return new Set(hosts.map((h) => h.toLowerCase()));
}

export function checkHost(host: string | undefined, allowed: Set<string>): boolean {
  return typeof host === 'string' && allowed.has(host.toLowerCase());
}

/** P0-7-R6: 상태를 바꾸는 요청은 Origin이 허용 출처(http://<허용 Host>)와 같을 때만 */
export function checkOrigin(origin: string | undefined, allowed: Set<string>): boolean {
  if (typeof origin !== 'string' || !origin.startsWith('http://')) return false;
  return allowed.has(origin.slice('http://'.length).toLowerCase());
}

/**
 * isLocal(루프백)은 로컬 토큰 세션(localAuthed), 다른 기기는 LAN 토큰 세션(authed)으로 본다.
 * 루프백이라서 인증을 건너뛰지 않는다: 같은 PC의 다른 프로세스·사용자도 루프백으로 들어온다
 */
export function decideAccess(o: { mode: ServerMode; isLocal: boolean; authed: boolean; localAuthed: boolean; access: Access; lanAllowAnalyze: boolean }): 'ok' | 401 | 403 {
  if (o.access === 'public') return 'ok';
  if (o.isLocal) return o.localAuthed ? 'ok' : 401;
  if (o.mode === 'local') return 403; // 바인딩과 별도의 이중 방어 (P0-7-T1)
  if (!o.authed) return 401;
  if (o.access === 'read') return 'ok';
  if (o.access === 'analyze' && o.lanAllowAnalyze) return 'ok';
  return 403;
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * 접속 토큰과 세션 (P0-7.3). 토큰은 서버 시작·재발급마다 새로 만든다(R1). 재발급하면 모든 세션이 무효가 된다.
 * LAN 토큰은 2시간 뒤 만료되고(R2) 세션 쿠키도 토큰의 만료 시각을 따른다. 로컬 토큰(ttlMs: null)은 서버 실행 동안 유효하고,
 * 세션 쿠키는 브라우저 세션 쿠키(Max-Age 없음)다.
 */
export class TokenAuth {
  private readonly now: () => number;
  private readonly ttlMs: number | null;
  private current = '';
  private expires = 0;
  private sessions = new Map<string, number>();

  constructor(opts: { now?: () => number; ttlMs?: number | null } = {}) {
    this.now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs === undefined ? LAN_TOKEN_TTL_MS : opts.ttlMs;
    this.rotate();
  }

  get token(): string {
    return this.current;
  }

  get expiresAt(): Date {
    return new Date(this.expires);
  }

  rotate(): void {
    this.current = randomBytes(16).toString('base64url');
    this.expires = this.ttlMs === null ? Infinity : this.now() + this.ttlMs;
    this.sessions = new Map();
  }

  verifyToken(t: string): boolean {
    return this.now() < this.expires && sameSecret(t, this.current);
  }

  /** maxAgeSeconds가 null이면 만료 없는 토큰: 쿠키에 Max-Age를 붙이지 않는다 */
  createSession(): { id: string; maxAgeSeconds: number | null } {
    const id = randomBytes(24).toString('base64url');
    // Map은 넣은 순서를 지킨다: 상한을 넘으면 가장 오래된 세션부터 버린다
    while (this.sessions.size >= MAX_LAN_SESSIONS) this.sessions.delete(this.sessions.keys().next().value!);
    this.sessions.set(id, this.expires);
    return { id, maxAgeSeconds: this.expires === Infinity ? null : Math.max(1, Math.floor((this.expires - this.now()) / 1000)) };
  }

  verifySession(id: string | undefined): boolean {
    if (!id) return false;
    const exp = this.sessions.get(id);
    if (exp === undefined) return false;
    if (this.now() >= exp) {
      this.sessions.delete(id);
      return false;
    }
    return true;
  }

  /** 로그·오류에서 가릴 값 (P0-7-R4) */
  secrets(): string[] {
    return [this.current, ...this.sessions.keys()];
  }
}

export { TokenAuth as LanAuth };

/** 세션 쿠키 헤더 (HttpOnly, SameSite=Strict: 다른 사이트에서 시작한 요청에는 쿠키가 실리지 않는다) */
export function sessionCookie(name: string, s: { id: string; maxAgeSeconds: number | null }): string {
  return `${name}=${s.id}; HttpOnly; SameSite=Strict; Path=/${s.maxAgeSeconds === null ? '' : `; Max-Age=${s.maxAgeSeconds}`}`;
}

/** 고정 창이 아니라 최근 1분 요청 시각으로 센다 */
export class RateLimiter {
  private readonly now: () => number;
  private readonly windowMs: number;
  private readonly hits = new Map<string, number[]>();

  constructor(now: () => number = Date.now, windowMs: number = RATE_LIMITS.windowMs) {
    this.now = now;
    this.windowMs = windowMs;
  }

  hit(key: string, limit: number): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(t);
    return true;
  }

  private prune(t: number): void {
    for (const [k, v] of this.hits) if (v.every((x) => t - x >= this.windowMs)) this.hits.delete(k);
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * P1-7-R13: sk-ant- 키, LAN 토큰·쿠키 값(secrets), 사용자 홈 경로의 사용자 이름을 가린다.
 * URL의 t= 값과 floor_lan=·floor_local= 쿠키 값은 목록에 없어도 가린다.
 */
export function redact(text: string, secrets: readonly string[] = [], home: string = ''): string {
  let out = text.replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-***');
  for (const s of secrets) if (s.length >= 8) out = out.replace(new RegExp(escapeRegExp(s), 'g'), '***');
  out = out.replace(/([?&]t=)[^&\s"'#]+/g, '$1***');
  out = out.replace(new RegExp(`((?:${SESSION_COOKIE}|${LOCAL_SESSION_COOKIE})=)[^;\\s"']+`, 'g'), '$1***');
  if (home.length > 1) out = out.replace(new RegExp(escapeRegExp(home), 'g'), '~');
  out = out.replace(/([/\\](?:Users|home)[/\\])[^/\\\s"']+/g, '$1***');
  return out;
}
