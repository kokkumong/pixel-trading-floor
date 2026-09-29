// 작업 기록 저장소 (P1 명세 1.3). 모든 쓰기는 같은 디렉터리의 임시 파일 → 동기화 → 이름 변경으로 원자적으로 한다.
// 디스크의 기록이 종료 상태면 더 이상 덮어쓰지 않는다 (P1-1-R3).
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { JobRecord } from './record.ts';
import { isTerminal, JobStateError } from './state.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isJobId(id: unknown): id is string {
  return typeof id === 'string' && UUID.test(id);
}

/** 임시 파일에 쓰고 디스크 동기화 뒤 이름을 바꾼다 */
export function writeFileAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.tmp-${randomBytes(6).toString('hex')}`);
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

export class JobStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  dir(jobId: string): string {
    if (!isJobId(jobId)) throw new Error(`잘못된 jobId: ${String(jobId).slice(0, 40)}`);
    return join(this.root, jobId);
  }

  /** 작업 디렉터리 안의 경로. 밖으로 나가는 상대 경로는 거부한다 */
  path(jobId: string, rel: string): string {
    const base = this.dir(jobId);
    const p = resolve(base, rel);
    const r = relative(base, p);
    if (r === '' || r.startsWith('..') || r.split(sep).includes('..')) throw new Error(`작업 디렉터리 밖의 경로: ${rel}`);
    return p;
  }

  create(rec: JobRecord): void {
    const file = join(this.dir(rec.jobId), 'job.json');
    if (existsSync(file)) throw new Error(`작업 기록이 이미 있음: ${rec.jobId}`);
    writeFileAtomic(file, JSON.stringify(rec, null, 2));
  }

  load(jobId: string): JobRecord {
    return JSON.parse(readFileSync(join(this.dir(jobId), 'job.json'), 'utf8')) as JobRecord;
  }

  save(rec: JobRecord): void {
    const file = join(this.dir(rec.jobId), 'job.json');
    if (existsSync(file)) {
      const cur = JSON.parse(readFileSync(file, 'utf8')) as JobRecord;
      if (isTerminal(cur.state)) throw new JobStateError(`종료된 작업(${cur.state})은 바꿀 수 없음: ${rec.jobId}`);
    }
    writeFileAtomic(file, JSON.stringify(rec, null, 2));
  }

  writeJson(jobId: string, rel: string, value: unknown): string {
    const p = this.path(jobId, rel);
    writeFileAtomic(p, JSON.stringify(value, null, 2));
    return p;
  }

  readJson<T = unknown>(jobId: string, rel: string): T {
    return JSON.parse(readFileSync(this.path(jobId, rel), 'utf8')) as T;
  }

  list(): JobRecord[] {
    if (!existsSync(this.root)) return [];
    const out: JobRecord[] = [];
    for (const name of readdirSync(this.root)) {
      if (!isJobId(name)) continue;
      try {
        out.push(this.load(name));
      } catch {
        // 기록이 없거나 깨진 디렉터리는 건너뛴다
      }
    }
    return out;
  }
}
