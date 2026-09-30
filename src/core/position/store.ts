// 포지션 북 저장 (P2-1-R1·R5, P2-5). 위치 <root>/.floor/positions.json (gitignore), 권한 0600, 직전 버전 1개를 .bak으로 둔다.
// 쓰기는 임시 파일 → fsync → rename이라 중간에 멈춰도 기존 파일이 남는다.
import { chmodSync, closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { validateBook, type BookError, type PositionBook } from './book.ts';

export const BOOK_DIR = '.floor';
export const BOOK_FILE = 'positions.json';

export function bookPath(root: string): string {
  return join(root, BOOK_DIR, BOOK_FILE);
}

export type BookRead =
  | { status: 'missing'; book: null }
  | { status: 'ok'; book: PositionBook }
  | { status: 'invalid'; book: null; errors: BookError[] };

/** 파일을 직접 고친 경우도 화면 입력과 같은 검증을 받는다 (P2-1-R1) */
export function readBook(root: string, isKnown: (instrumentId: string) => boolean): BookRead {
  const path = bookPath(root);
  if (!existsSync(path)) return { status: 'missing', book: null };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return { status: 'invalid', book: null, errors: [{ path: '$', message: `JSON 읽기 실패: ${(e as Error).message}` }] };
  }
  const r = validateBook(raw, isKnown);
  return r.ok ? { status: 'ok', book: r.book } : { status: 'invalid', book: null, errors: r.errors };
}

export interface WriteHooks {
  /** 테스트용: rename 직전에 멈춘 상황 흉내 */
  beforeRename?: () => void;
}

/** 검증을 통과한 북만 받는다. 기존 파일은 .bak으로 복사한 뒤 교체한다 */
export function writeBook(root: string, book: PositionBook, hooks: WriteHooks = {}): void {
  const dir = join(root, BOOK_DIR);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = bookPath(root);
  const tmp = join(dir, `.tmp-${randomBytes(6).toString('hex')}`);
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeSync(fd, JSON.stringify(book, null, 2) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    chmodSync(tmp, 0o600); // umask와 무관하게
    if (existsSync(path)) {
      copyFileSync(path, `${path}.bak`);
      chmodSync(`${path}.bak`, 0o600);
    }
    hooks.beforeRename?.();
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}
