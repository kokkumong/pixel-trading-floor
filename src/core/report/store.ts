// 리포트 저장소 (P1 명세 6.3, 6.4). reports/<이름>.json이 원본이고 .md는 JSON에서 만든다.
// 저장: .tmp-<jobId>.json·.tmp-<jobId>.md를 쓰고 동기화 → JSON → Markdown 순서로 이름 변경 (P1-6-R5).
// 목록은 JSON이 있는 리포트만 보여준다. 대상 파일이 있으면 덮어쓰지 않는다 (P1-6-R6).
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { FinalizeOptions } from '../job/engine.ts';
import { isJobId } from '../job/store.ts';
import { renderMarkdown } from './markdown.ts';
import { buildReport, localTzOffsetMinutes, REPORT_SCHEMA_VERSION, reportBaseName, reportTab, type Report, type ReportMeta, type ReportTab } from './report.ts';

export interface ReportStoreOptions {
  /** 파일명 시간대 (분). 없으면 이 PC의 시간대 */
  tzOffsetMinutes?: number;
  /** 테스트용: Markdown 이름 변경 직전 (P1-6-T2) */
  beforeMdRename?: () => void;
}

export interface ReportSummary {
  jobId: string;
  file: string;
  mode: Report['mode'];
  resultClass: Report['resultClass'];
  demo: boolean;
  instrumentId: string;
  displayName: string;
  completedAt: string;
  status: Report['finalDecision']['status'];
  action: Report['finalDecision']['action'];
  bias: Report['finalDecision']['bias'];
}

export const TMP_MAX_AGE_MS = 3600_000;

function writeSynced(path: string, text: string): void {
  const fd = openSync(path, 'w');
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** 이름 변경을 디스크에 남긴다 (POSIX만. Windows는 디렉터리를 열 수 없다) */
function syncDir(dir: string): void {
  if (process.platform === 'win32') return;
  try {
    const fd = openSync(dir, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
  } catch { /* 지원하지 않는 파일 시스템 */ }
}

export class ReportStore {
  readonly dir: string;
  private readonly opts: ReportStoreOptions;

  constructor(dir: string, opts: ReportStoreOptions = {}) {
    this.dir = resolve(dir);
    this.opts = opts;
  }

  save(report: Report): { json: string; md: string } {
    if (!isJobId(report.jobId)) throw new Error(`잘못된 jobId: ${String(report.jobId).slice(0, 40)}`);
    mkdirSync(this.dir, { recursive: true });
    const tz = this.opts.tzOffsetMinutes ?? localTzOffsetMinutes(new Date(report.completedAt));
    const base = join(this.dir, reportBaseName(report, tz));
    const json = `${base}.json`;
    const md = `${base}.md`;
    const tmpJson = join(this.dir, `.tmp-${report.jobId}.json`);
    const tmpMd = join(this.dir, `.tmp-${report.jobId}.md`);
    const exists = () => [json, md].find((p) => existsSync(p));
    const dup = exists();
    if (dup) throw new Error(`리포트 파일이 이미 있음: ${dup}`);

    try {
      writeSynced(tmpJson, JSON.stringify(report, null, 2));
      writeSynced(tmpMd, renderMarkdown(report));
      const late = exists();
      if (late) throw new Error(`리포트 파일이 이미 있음: ${late}`);
      renameSync(tmpJson, json);
    } catch (e) {
      rmSync(tmpJson, { force: true });
      rmSync(tmpMd, { force: true });
      throw e;
    }
    try {
      this.opts.beforeMdRename?.();
      renameSync(tmpMd, md);
    } catch (e) {
      // 같은 프로세스 안의 실패는 되돌린다: 리포트가 없는 FAILED 작업이 된다 (E-DISK)
      rmSync(json, { force: true });
      rmSync(tmpMd, { force: true });
      throw e;
    }
    syncDir(this.dir);
    return { json, md };
  }

  private jsonFiles(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir).filter((n) => n.endsWith('.json') && !n.startsWith('.')).sort().reverse().map((n) => join(this.dir, n));
  }

  private read(file: string): Report | null {
    try {
      const r = JSON.parse(readFileSync(file, 'utf8')) as Report;
      return r && Number.isInteger(r.reportSchemaVersion) && r.reportSchemaVersion >= 1 && r.reportSchemaVersion <= REPORT_SCHEMA_VERSION && isJobId(r.jobId) && r.finalDecision ? r : null;
    } catch {
      return null; // 깨진 파일은 목록에서 뺀다
    }
  }

  /** 최신순. 기본 탭은 analysis(데모 제외) (P1-6-R8) */
  list(tab: ReportTab = 'analysis'): ReportSummary[] {
    const out: ReportSummary[] = [];
    for (const file of this.jsonFiles()) {
      if (!this.inside(file)) continue; // P0-7-R8: 링크로 reports/ 밖을 가리키는 파일은 목록에도 넣지 않는다
      const r = this.read(file);
      if (!r || reportTab(r) !== tab) continue;
      out.push({
        jobId: r.jobId, file, mode: r.mode, resultClass: r.resultClass, demo: r.demo, instrumentId: r.instrumentId, displayName: r.displayName,
        completedAt: r.completedAt, status: r.finalDecision.status, action: r.finalDecision.action, bias: r.finalDecision.bias,
      });
    }
    return out.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  }

  /** 리포트 ID(jobId)로 조회 (P1-6-R9). 파일명에는 앞 8자만 있으므로 내용의 jobId로 확인한다 */
  get(jobId: string): Report | null {
    return this.locate(jobId)?.report ?? null;
  }

  /**
   * 리포트 ID로 파일을 찾는다 (P0-7-R8). 경로 문자열을 받지 않고, 링크를 따라간 실제 경로가 reports/ 밖이면 거부한다.
   * md는 Markdown이 아직 없으면(이름 변경 직전 중단, repair 전) null
   */
  locate(jobId: string): { report: Report; json: string; md: string | null } | null {
    if (!isJobId(jobId)) return null;
    for (const file of this.jsonFiles()) {
      if (!file.includes(`_${jobId.slice(0, 8)}`)) continue;
      if (!this.inside(file)) continue;
      const r = this.read(file);
      if (r?.jobId !== jobId) continue;
      const md = file.replace(/\.json$/, '.md');
      return { report: r, json: file, md: existsSync(md) && this.inside(md) ? md : null };
    }
    return null;
  }

  private inside(file: string): boolean {
    try {
      const rel = relative(realpathSync(this.dir), realpathSync(file));
      return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
    } catch {
      return false;
    }
  }

  /** JSON만 있고 Markdown이 없는 리포트(이름 변경 직전 중단)의 Markdown을 JSON에서 다시 만든다 */
  repair(): string[] {
    const made: string[] = [];
    for (const file of this.jsonFiles()) {
      const md = file.replace(/\.json$/, '.md');
      if (existsSync(md)) continue;
      const r = this.read(file);
      if (!r) continue;
      const tmp = join(this.dir, `.tmp-repair-${r.jobId}.md`);
      writeSynced(tmp, renderMarkdown(r));
      renameSync(tmp, md);
      made.push(md);
    }
    return made;
  }

  /** P1-6-R7: 1시간이 지난 임시 파일을 지운다 (서버 시작 시) */
  cleanupTmp(now: Date, maxAgeMs = TMP_MAX_AGE_MS): string[] {
    if (!existsSync(this.dir)) return [];
    const removed: string[] = [];
    for (const n of readdirSync(this.dir)) {
      if (!n.startsWith('.tmp-')) continue;
      const p = join(this.dir, n);
      try {
        if (now.getTime() - statSync(p).mtimeMs > maxAgeMs) {
          rmSync(p, { force: true });
          removed.push(p);
        }
      } catch { /* 이미 지워짐 */ }
    }
    return removed;
  }
}

/** engine.finalize의 SAVING 단계에서 리포트를 저장한다. 저장한 경로는 작업 기록에 남긴다 */
export function reportSaver(store: ReportStore, meta: ReportMeta, now: () => Date = () => new Date()): NonNullable<FinalizeOptions['save']> {
  return (job) => {
    const paths = store.save(buildReport(job, meta, now()));
    job.record.report = paths;
  };
}
