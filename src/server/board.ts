// 전광판 API의 서버 쪽 (GET /api/board). 종목 해석 → 조회(종목마다 15초 캐시, 동시 요청은 하나로 묶음) → buildBoard.
// 데모는 녹화 fixture 기록만 쓰고 종목 조회도 하지 않는다: 데모 경로에는 네트워크 클라이언트가 없다 (P1-8-R5, P0-6-R2).
import { BOARD_REFRESH_SECONDS, buildBoard, collectBoardSources, type Board } from '../core/board.ts';
import { yahooUsLookup } from '../core/data/adapters.ts';
import { createRealNet, type NetClient } from '../core/data/net.ts';
import { InstrumentRegistry, normalizeSymbolInput, type Candidate } from '../core/data/registry.ts';
import { DemoUnavailableError, demoModes, loadDemo } from '../core/demo.ts';

export type BoardResult =
  | { ok: true; board: Board }
  | { ok: false; status: 400; code: 'E-INPUT' | 'E-UNSUPPORTED-SYMBOL' | 'E-DEMO'; message: string; candidates?: Candidate[] };

export interface BoardServiceOptions {
  net?: NetClient;
  now?: () => Date;
  registry?: InstrumentRegistry;
  demoDir?: string;
  ttlMs?: number;
}

export class BoardService {
  private readonly o: BoardServiceOptions;
  private readonly net: NetClient;
  private readonly registry: InstrumentRegistry;
  private readonly now: () => Date;
  private readonly cache = new Map<string, { at: number; board: Promise<Board> }>();

  constructor(o: BoardServiceOptions = {}) {
    this.o = o;
    this.net = o.net ?? createRealNet();
    this.registry = o.registry ?? new InstrumentRegistry();
    this.now = o.now ?? (() => new Date());
  }

  async get(symbol: unknown, demo: boolean): Promise<BoardResult> {
    const input = normalizeSymbolInput(symbol);
    if (!input.ok) return { ok: false, status: 400, code: 'E-INPUT', message: input.message };
    return demo ? this.demo(input.normalized) : this.live(symbol as string);
  }

  private demo(normalized: string): BoardResult {
    let s: ReturnType<typeof loadDemo>;
    try {
      const modes = demoModes(this.o.demoDir);
      s = loadDemo(modes.includes('algorithm') ? 'algorithm' : modes[0]!, this.o.demoDir);
    } catch (e) {
      if (e instanceof DemoUnavailableError) return { ok: false, status: 400, code: 'E-DEMO', message: e.message };
      throw e;
    }
    if (s.symbol.toUpperCase() !== normalized) return { ok: false, status: 400, code: 'E-DEMO', message: `데모는 ${s.symbol}만 있습니다` };
    // 조회 없는 해석만 한다. 데모 경로는 네트워크 클라이언트를 쓰지 않는다
    const r = this.registry.resolve(s.symbol, 'algorithm');
    if (!r.ok) return { ok: false, status: 400, code: 'E-DEMO', message: r.message };
    return { ok: true, board: buildBoard(r.instrument, structuredClone(s.records), new Date(s.collectedAt), true) };
  }

  private async live(symbol: string): Promise<BoardResult> {
    const r = await this.registry.resolveWithLookup(symbol, 'algorithm', yahooUsLookup(this.net));
    if (!r.ok) return { ok: false, status: 400, code: 'E-UNSUPPORTED-SYMBOL', message: r.message, candidates: r.candidates };
    const id = r.instrument.instrumentId;
    const t = this.now().getTime();
    const hit = this.cache.get(id);
    if (hit && t - hit.at < (this.o.ttlMs ?? BOARD_REFRESH_SECONDS * 1000)) return { ok: true, board: await hit.board };
    const board = collectBoardSources(this.net, r.instrument).then((records) => buildBoard(r.instrument, records, this.now(), false));
    this.cache.set(id, { at: t, board });
    board.catch(() => this.cache.delete(id));
    if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!);
    return { ok: true, board: await board };
  }
}
