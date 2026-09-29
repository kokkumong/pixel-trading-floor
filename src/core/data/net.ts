// 모든 외부 요청의 단일 통로 (P0-6-R1, P1-7-R8, R9). 도메인 허용 목록이 곧 네트워크 목적지 부록이다.
// 데모 모드는 BlockedNet을 끼워 넣어 실전 구현이 아예 연결되지 않게 한다 (P1-8-R2).

/** 네트워크 목적지 부록 (P0-6-R1). 여기 없는 호스트로는 요청하지 않는다. */
export const ALLOWED_HOSTS = {
  'api.binance.com': 'Binance 현물 시세·캔들',
  'fapi.binance.com': 'Binance USDT 무기한 선물 시세·캔들·펀딩',
  'api.bybit.com': 'Bybit 무기한 선물 시세 (비교·추정용)',
  'api.bitget.com': 'Bitget 무기한 선물 시세 (비교·추정용)',
  'api.gateio.ws': 'Gate 무기한 선물 시세 (비교·추정용)',
  'query1.finance.yahoo.com': 'Yahoo Finance 주식 시세·캔들·환율·미국 종목 조회',
  'api.coingecko.com': 'CoinGecko 코인 기본 지표',
  'api.alternative.me': '공포탐욕지수',
  'news.google.com': 'Google 뉴스 RSS 헤드라인',
} as const;

export const NET_LIMITS = { timeoutMs: 10_000, maxBytes: 5 * 1024 * 1024, maxRedirects: 2 } as const;

export type NetErrorCode = 'NET_BLOCKED' | 'NET_NOT_ALLOWED' | 'NET_TIMEOUT' | 'NET_HTTP' | 'NET_TOO_LARGE' | 'NET_CONTENT_TYPE' | 'NET_REDIRECT' | 'NET_FAILED';

export class NetError extends Error {
  readonly code: NetErrorCode;
  constructor(code: NetErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface HttpResult {
  url: string;
  status: number;
  body: string;
  /** 응답 Date 헤더 (시계 오차 진단용, P1-8.2) */
  date: string | null;
  fetchedAt: string;
}

export type Expect = 'json' | 'xml';

export interface NetClient {
  readonly kind: 'real' | 'blocked' | 'fixture';
  get(url: string, expect: Expect): Promise<HttpResult>;
}

export function assertAllowed(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new NetError('NET_NOT_ALLOWED', `잘못된 주소: ${url}`);
  }
  if (u.protocol !== 'https:') throw new NetError('NET_NOT_ALLOWED', `HTTPS만 허용: ${u.origin}`);
  if (!Object.hasOwn(ALLOWED_HOSTS, u.hostname) || u.port !== '' || u.username || u.password) {
    throw new NetError('NET_NOT_ALLOWED', `허용 목록에 없는 목적지: ${u.host}`);
  }
  return u;
}

function contentTypeOk(ct: string, expect: Expect): boolean {
  const t = ct.toLowerCase();
  return expect === 'json' ? t.includes('json') : t.includes('xml') || t.includes('rss');
}

export function createRealNet(opts: { userAgent?: string } = {}): NetClient {
  const headers = { 'user-agent': opts.userAgent ?? 'PixelTradingFloor/0.1 (+local analysis app)', accept: '*/*' };
  return {
    kind: 'real',
    async get(url, expect) {
      let target = assertAllowed(url);
      for (let hop = 0; ; hop++) {
        let res: Response;
        try {
          res = await fetch(target, { headers, redirect: 'manual', signal: AbortSignal.timeout(NET_LIMITS.timeoutMs) });
        } catch (e) {
          const name = (e as Error).name;
          throw new NetError(name === 'TimeoutError' || name === 'AbortError' ? 'NET_TIMEOUT' : 'NET_FAILED', `${target.host}: ${(e as Error).message}`);
        }
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get('location');
          if (!loc || hop >= NET_LIMITS.maxRedirects) throw new NetError('NET_REDIRECT', `리디렉션 한도 초과 또는 위치 없음: ${target.host}`);
          target = assertAllowed(new URL(loc, target).toString());
          continue;
        }
        if (!res.ok) throw new NetError('NET_HTTP', `${target.host} HTTP ${res.status}`);
        const ct = res.headers.get('content-type') ?? '';
        if (!contentTypeOk(ct, expect)) throw new NetError('NET_CONTENT_TYPE', `${target.host} 예상 밖 형식: ${ct}`);
        const declared = Number(res.headers.get('content-length') ?? '0');
        if (declared > NET_LIMITS.maxBytes) throw new NetError('NET_TOO_LARGE', `${target.host} 응답 ${declared}바이트`);
        const body = await readLimited(res, NET_LIMITS.maxBytes, target.host);
        return { url: target.toString(), status: res.status, body, date: res.headers.get('date'), fetchedAt: new Date().toISOString() };
      }
    },
  };
}

async function readLimited(res: Response, max: number, host: string): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new NetError('NET_TOO_LARGE', `${host} 응답이 ${max}바이트를 넘음`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** 데모 모드용: 어떤 요청도 보내지 않고 즉시 실패한다. */
export function createBlockedNet(): NetClient {
  return {
    kind: 'blocked',
    async get(url) {
      throw new NetError('NET_BLOCKED', `데모 모드에서는 외부 요청을 보내지 않습니다: ${safeHost(url)}`);
    },
  };
}

/** 테스트·녹화 재생용: URL → 응답 본문. 허용 목록 검사는 실전과 똑같이 한다. */
export function createFixtureNet(responses: Record<string, string | NetError>, fetchedAt = '2026-09-29T00:00:00.000Z'): NetClient & { requests: string[] } {
  const requests: string[] = [];
  return {
    kind: 'fixture',
    requests,
    async get(url) {
      assertAllowed(url);
      requests.push(url);
      const r = responses[url];
      if (r === undefined) throw new NetError('NET_HTTP', `fixture 없음: ${url}`);
      if (r instanceof NetError) throw r;
      return { url, status: 200, body: r, date: null, fetchedAt };
    },
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '?';
  }
}
