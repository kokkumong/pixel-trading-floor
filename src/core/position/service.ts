// 포지션 북 읽기·교체 (서버 GET/PUT /api/positions와 CLI 분석이 같이 쓴다, P2-1-R1·R2).
// 화면 폼은 종목을 분석 입력처럼 글자로 보낼 수 있다(symbol). 서버가 레지스트리로 instrumentId를 정해 저장한다.
import { InstrumentRegistry, type UsLookup } from '../data/registry.ts';
import { emptyBook, validateBook, type BookError, type PositionBook } from './book.ts';
import { readBook, writeBook, type BookRead } from './store.ts';

const US_ID = /^US:[A-Z]{1,5}(\.[A-Z])?$/;
const noLookup: UsLookup = async () => null;

export interface PositionServiceOptions {
  root: string;
  registry?: InstrumentRegistry;
  /** 미국 종목 조회 (기본: 조회 안 함). 서버는 실제 조회를 넣는다 */
  lookup?: UsLookup;
  now?: () => Date;
}

export interface BookView {
  status: BookRead['status'];
  book: PositionBook;
  errors: BookError[];
  /** 화면 표시용 종목 이름 (instrumentId → 이름) */
  names: Record<string, string>;
}

export type PutResult = { ok: true; view: BookView } | { ok: false; errors: BookError[] };

export class PositionService {
  private readonly o: PositionServiceOptions;
  private readonly registry: InstrumentRegistry;
  private readonly now: () => Date;

  constructor(o: PositionServiceOptions) {
    this.o = o;
    this.registry = o.registry ?? new InstrumentRegistry();
    this.now = o.now ?? (() => new Date());
  }

  /** 미국 종목은 저장할 때 조회로 확인했으므로 형식만 본다 (재시작 뒤 조회 캐시가 비어도 읽히도록) */
  readonly isKnown = (id: string): boolean => this.registry.get(id) !== undefined || US_ID.test(id);

  read(): BookRead {
    return readBook(this.o.root, this.isKnown);
  }

  view(): BookView {
    const r = this.read();
    const book = r.book ?? emptyBook(this.now());
    return { status: r.status, book, errors: r.status === 'invalid' ? r.errors : [], names: this.names(book) };
  }

  /** 북 전체 교체. updatedAt은 서버 시각으로 정한다 */
  async put(raw: unknown): Promise<PutResult> {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, errors: [{ path: '$', message: '객체여야 함' }] };
    const body: Record<string, unknown> = { ...(raw as Record<string, unknown>), updatedAt: this.now().toISOString() };
    const errors: BookError[] = [];
    if (Array.isArray(body.positions)) {
      body.positions = await Promise.all(body.positions.map(async (p: unknown, i: number) => {
        if (typeof p !== 'object' || p === null || !('symbol' in p)) return p;
        const { symbol, ...rest } = p as Record<string, unknown>;
        if (rest.instrumentId !== undefined) return rest;
        const res = await this.registry.resolveWithLookup(symbol, 'algorithm', this.o.lookup ?? noLookup);
        if (!res.ok) {
          errors.push({ path: `$.positions[${i}].symbol`, message: `${res.message}: ${String(symbol).slice(0, 32)}` });
          return rest;
        }
        return { ...rest, instrumentId: res.instrument.instrumentId };
      }));
    }
    const r = validateBook(body, this.isKnown);
    if (!r.ok || errors.length) {
      // 종목을 못 찾은 포지션의 "instrumentId 누락"은 같은 원인이라 뺀다
      const unresolved = new Set(errors.map((e) => e.path.replace(/\.symbol$/, '.instrumentId')));
      return { ok: false, errors: [...errors, ...(r.ok ? [] : r.errors.filter((e) => !unresolved.has(e.path)))] };
    }
    writeBook(this.o.root, r.book);
    return { ok: true, view: { status: 'ok', book: r.book, errors: [], names: this.names(r.book) } };
  }

  private names(book: PositionBook): Record<string, string> {
    return Object.fromEntries(book.positions.map((p) => [p.instrumentId, this.registry.get(p.instrumentId)?.displayName ?? p.instrumentId.replace(/^US:/, '')]));
  }
}
