// HTTP 서버의 보안 경계 (P0 명세 7장, P1 명세 7.5). 네트워크를 쓰지 않는 순수한 부품만 둔다.
// 로컬 전용(기본): 127.0.0.1 바인딩, 토큰 없음. LAN 공유(--lan): 0.0.0.0 바인딩, 시작마다 새 토큰, 다른 기기는 읽기 전용.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';

export type ServerMode = 'local' | 'lan';

/** P0-7-R2: 토큰과 세션 쿠키의 수명 */
export const LAN_TOKEN_TTL_MS = 2 * 3600_000;
export const SESSION_COOKIE = 'floor_lan';
/** P0-7-R7: IP당 1분 요청 수 */
export const RATE_LIMITS = { analyzePerMinute: 3, otherPerMinute: 120, windowMs: 60_000 } as const;

/**
 * 경로별 접근 등급 (P0-7.4 표):
 * read = LAN 토큰 인증 기기도 허용 (화면, 작업 진행, 리포트 목록·열람)
 * analyze = 분석 실행·취소. LAN 기기는 --lan-allow-analyze일 때만
 * local = 서버 PC에서만 (all.zip, project.zip, 진단, 토큰 재발급)
 */
export type Access = 'read' | 'analyze' | 'local';

export function isLoopback(addr: string | undefined): boolean {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/** 이 PC의 LAN IPv4 주소 (LAN 모드 Host 허용 목록용) */
export function lanIPv4Addresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
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

export function decideAccess(o: { mode: ServerMode; isLocal: boolean; authed: boolean; access: Access; lanAllowAnalyze: boolean }): 'ok' | 401 | 403 {
  if (o.isLocal) return 'ok';
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
 * LAN 토큰과 세션 (P0-7.3). 토큰은 서버 시작·재발급마다 새로 만들고(R1) 2시간 뒤 만료된다(R2).
 * 세션 쿠키는 토큰의 만료 시각을 따르고, 재발급하면 모든 세션이 무효가 된다.
 */
export class LanAuth {
  private readonly now: () => number;
  private readonly ttlMs: number;
  private current = '';
  private expires = 0;
  private sessions = new Map<string, number>();

  constructor(opts: { now?: () => number; ttlMs?: number } = {}) {
    this.now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs ?? LAN_TOKEN_TTL_MS;
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
    this.expires = this.now() + this.ttlMs;
    this.sessions = new Map();
  }

  verifyToken(t: string): boolean {
    return this.now() < this.expires && sameSecret(t, this.current);
  }

  createSession(): { id: string; maxAgeSeconds: number } {
    const id = randomBytes(24).toString('base64url');
    this.sessions.set(id, this.expires);
    return { id, maxAgeSeconds: Math.max(1, Math.floor((this.expires - this.now()) / 1000)) };
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
 * URL의 t= 값과 floor_lan= 쿠키 값은 목록에 없어도 가린다.
 */
export function redact(text: string, secrets: readonly string[] = [], home: string = ''): string {
  let out = text.replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-***');
  for (const s of secrets) if (s.length >= 8) out = out.replace(new RegExp(escapeRegExp(s), 'g'), '***');
  out = out.replace(/([?&]t=)[^&\s"'#]+/g, '$1***');
  out = out.replace(new RegExp(`(${SESSION_COOKIE}=)[^;\\s"']+`, 'g'), '$1***');
  if (home.length > 1) out = out.replace(new RegExp(escapeRegExp(home), 'g'), '~');
  out = out.replace(/([/\\](?:Users|home)[/\\])[^/\\\s"']+/g, '$1***');
  return out;
}
