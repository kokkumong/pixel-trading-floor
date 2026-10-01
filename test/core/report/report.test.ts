import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CALENDAR_VERSION } from '../../../src/core/data/calendar.ts';
import { INDICATORS_VERSION } from '../../../src/core/data/indicators.ts';
import { hashSnapshot } from '../../../src/core/data/snapshot.ts';
import { createEngine, type Engine } from '../../../src/core/job/engine.ts';
import { runJob } from '../../../src/core/job/runner.ts';
import { JobStore } from '../../../src/core/job/store.ts';
import { createPromptSet, PROMPT_DIR, type PromptSet } from '../../../src/core/prompts/index.ts';
import { renderMarkdown } from '../../../src/core/report/markdown.ts';
import { reportBaseName, type Report } from '../../../src/core/report/report.ts';
import { ReportStore, reportSaver } from '../../../src/core/report/store.ts';
import { RULE_ENGINE_VERSION } from '../../../src/core/rules/engine.ts';
import type { Mode } from '../../../src/core/schema/types.ts';
import { APP_VERSION, CORE_VERSION } from '../../../src/core/version.ts';
import { registry, replayAcquirer } from '../../data-helpers.ts';
import { autoDriver, floorDrive, sampleOutput, sampleProposal } from '../../job-helpers.ts';

const FIXTURE: Record<Mode, string> = { algorithm: 'btc-algorithm', scalp: 'btc-scalp', forced_direction: 'btc-scalp' };
const META = { claudeCliVersion: '2.1.284 (Claude Code)' };
const noSleep = async () => true;

function dirs() {
  const root = mkdtempSync(join(tmpdir(), 'floor-report-'));
  return { jobs: new JobStore(join(root, 'jobs')), reports: new ReportStore(join(root, 'reports'), { tzOffsetMinutes: 540 }), root };
}

interface RunOpts { iface?: 'web' | 'floor'; prompts?: PromptSet; demo?: boolean; at?: Date; d?: ReturnType<typeof dirs>; driver?: ReturnType<typeof autoDriver> }

async function completed(mode: Mode, o: RunOpts = {}) {
  const r = replayAcquirer(FIXTURE[mode]);
  const d = o.d ?? dirs();
  const at = o.at ?? r.at;
  const engine = createEngine({ store: d.jobs, now: () => at, ...(o.prompts ? { prompts: o.prompts } : {}) });
  const job = await engine.createJob({ idempotencyKey: `k-${Math.random()}`, mode, symbolInput: r.symbol, interface: o.iface ?? 'web', demo: o.demo ?? false }, r.acquirer);
  const save = reportSaver(d.reports, META, () => at);
  if ((o.iface ?? 'web') === 'floor') {
    floorDrive(engine, job.record.jobId);
    const j = engine.openJob(job.record.jobId);
    engine.finalize(j, { save });
    return { ...d, engine, job: j, at };
  }
  await runJob(engine, job, o.driver ?? autoDriver(), new AbortController().signal, { sleep: noSleep, save });
  return { ...d, engine, job, at };
}

const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as Report;

test('P1-6-T4 리포트 JSON만으로 모드·스냅샷·프롬프트·모델·규칙 엔진 버전을 알 수 있다', async () => {
  const { job, reports } = await completed('algorithm');
  assert.equal(job.record.state, 'COMPLETED');
  const paths = job.record.report!;
  assert.ok(paths.json.endsWith('.json') && existsSync(paths.json) && existsSync(paths.md));
  const rep = readJson(paths.json);
  assert.equal(rep.reportSchemaVersion, 3);
  assert.equal(rep.appVersion, APP_VERSION);
  assert.equal(rep.coreVersion, CORE_VERSION);
  assert.equal(rep.mode, 'algorithm');
  assert.equal(rep.status, 'COMPLETED');
  assert.equal(rep.resultClass, 'analysis');
  assert.equal(rep.interface, 'web');
  assert.equal(rep.executionBackend, 'subprocess_per_role');
  assert.equal(rep.jobId, job.record.jobId);
  assert.equal(rep.idempotencyKey, job.record.idempotencyKey);
  // P1-6-R2 스냅샷 전체가 들어 있고 해시로 연결된다
  assert.equal(rep.snapshotId, rep.snapshot.snapshotId);
  assert.equal(rep.snapshotHash, rep.snapshot.snapshotHash);
  assert.equal(hashSnapshot(rep.snapshot), rep.snapshotHash);
  // 버전: 프롬프트는 내용 해시, 모델은 CLI 보고값, 설정 모델은 따로
  assert.deepEqual(rep.versions.prompts, job.record.promptHashes);
  assert.equal(Object.keys(rep.versions.prompts).length, 11);
  for (const role of Object.keys(rep.versions.prompts)) assert.equal(rep.versions.models[role as 'TARO'], 'scripted', role);
  assert.equal(rep.versions.configuredModels.TARO, 'sonnet');
  assert.equal(rep.versions.ruleEngine, RULE_ENGINE_VERSION);
  assert.equal(rep.versions.indicators, INDICATORS_VERSION);
  assert.equal(rep.versions.calendar, CALENDAR_VERSION);
  assert.equal(rep.versions.registry, registry.version);
  assert.equal(rep.versions.claudeCli, META.claudeCliVersion);
  assert.equal(rep.analystIndependence, 'isolated');
  assert.equal(rep.budgetEnforcement, 'full');
  assert.deepEqual(rep.retrospective, { enabled: false, reportIds: [] });
  assert.deepEqual(rep.usage.plannedModelCallRange, { min: 11, max: 13 });
  assert.equal(rep.usage.modelCallCount, 13);
  assert.equal(rep.usage.calls.length, 13);
  assert.equal(rep.usage.roleTurnCount, null);
  assert.equal(typeof rep.usage.durationSeconds, 'number');
  assert.deepEqual(rep.finalDecision, job.record.finalDecision);
  assert.equal(rep.proposals.length, 1); // ACE (PM APPROVE는 수정안이 없다)
  assert.deepEqual(Object.keys(rep.briefings).sort(), ['DIANA', 'NOVA', 'TARO', 'VIBE']);
  assert.equal(rep.debate.messages.length, 4);
  assert.equal(rep.reviews.length, 3);
  assert.equal(rep.pm?.pmDecision, 'APPROVE');
  assert.deepEqual(rep.riskReview, { reviewed: true, reviewers: ['RISKY', 'SAFE', 'NEUTRAL'], timing: 'post_proposal' });
  // P1-6-R1 Markdown은 JSON에서 생성한다
  const md = readFileSync(paths.md, 'utf8');
  assert.equal(md, renderMarkdown(rep));
  assert.match(md, /PM 승인/);
  assert.match(md, /TARO/);
  assert.match(md, /과거 판정 회고: 꺼짐/);
  assert.doesNotMatch(md, /확신도[^\n]*%/); // P0-3-R6
  assert.equal(reports.get(rep.jobId)?.jobId, rep.jobId); // P1-6-R9 jobId로 조회
});

test('P1-10-T2 리포트: 근거를 확인할 수 없는 주장 옆에 표시하고, 근거 검사 절에 모두 남긴다', async () => {
  const driver = autoDriver({
    TARO: (input) => {
      const out = sampleOutput('TARO', input) as { claims: { evidenceRefs: string[] }[] };
      out.claims[0]!.evidenceRefs = ['snap:binance.perp.price#/nope'];
      return { output: out };
    },
  });
  const { job } = await completed('scalp', { driver });
  const rep = readJson(job.record.report!.json);
  assert.deepEqual(rep.evidenceAudit.map((x) => `${x.label}:${x.role}:${x.claimId}`), ['근거 확인 불가:TARO:c1']);
  const md = readFileSync(job.record.report!.md, 'utf8');
  assert.match(md, /`c1` \(observation\) 관찰 — snap:binance\.perp\.price#\/nope ⚠ 근거 확인 불가/);
  assert.match(md, /## 근거 검사[\s\S]*- 근거 확인 불가 · TARO c1 · snap:binance\.perp\.price#\/nope/);
  const clean = await completed('scalp');
  assert.deepEqual(readJson(clean.job.record.report!.json).evidenceAudit, []);
  assert.match(readFileSync(clean.job.record.report!.md, 'utf8'), /## 근거 검사\n\n- 문제 없음/);
});

test('P1-6-T1 같은 종목·모드를 같은 초에 두 번 분석해도 두 리포트가 모두 남는다', async () => {
  const d = dirs();
  const a = await completed('scalp', { d });
  const b = await completed('scalp', { d, at: a.at });
  assert.notEqual(a.job.record.report!.json, b.job.record.report!.json);
  const list = d.reports.list();
  assert.equal(list.length, 2);
  assert.deepEqual(new Set(list.map((x) => x.jobId)), new Set([a.job.record.jobId, b.job.record.jobId]));
  const names = readdirSync(join(d.root, 'reports')).sort();
  assert.equal(names.length, 4);
  assert.ok(names.every((n) => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\+09-00_CRYPTO-BTC_scalp_[0-9a-f]{8}\.(json|md)$/.test(n)), names.join(', '));
});

test('P1-6 파일명: 완료 시각(시간대 포함)_종목_모드_jobId 앞 8자, 데모·시뮬레이션 접미사', async () => {
  const { job } = await completed('scalp');
  const rep = readJson(job.record.report!.json);
  const base = reportBaseName(rep, 540);
  assert.equal(base, `${reportBaseName(rep, 540).slice(0, 25)}_CRYPTO-BTC_scalp_${rep.jobId.slice(0, 8)}`);
  assert.match(reportBaseName({ ...rep, completedAt: '2026-09-29T06:28:43.512Z' }, 540), /^2026-09-29T15-28-43\+09-00_/);
  assert.match(reportBaseName({ ...rep, completedAt: '2026-09-29T06:28:43.512Z' }, -300), /^2026-09-29T01-28-43-05-00_/);
  assert.match(reportBaseName({ ...rep, demo: true }, 0), /_DEMO$/);
  assert.match(reportBaseName({ ...rep, resultClass: 'lightweight' }, 0), /_LITE$/);
});

test('P0-5-T2 강제 방향 리포트 파일명에 _SIM이 있고 resultClass: simulation, 헤더에 시뮬레이션 문구', async () => {
  const { job, reports } = await completed('forced_direction');
  const p = job.record.report!;
  assert.match(p.json, /_forced_direction_[0-9a-f]{8}_SIM\.json$/);
  const rep = readJson(p.json);
  assert.equal(rep.resultClass, 'simulation');
  assert.deepEqual(rep.riskReview, { reviewed: true, reviewers: ['GUARD'], timing: 'pre_proposal' });
  assert.equal(rep.pm, null);
  assert.equal(rep.proposals.length, 2); // BLITZ 계획 + ACE
  const md = readFileSync(p.md, 'utf8');
  assert.match(md, /강제 방향 시뮬레이션 — 투자 판정이 아닙니다/);
  assert.doesNotMatch(md, /PM 승인/); // P0-2: PM이 없는 결과
  // P1-6-R8 기본 목록에서 빠지고 시뮬레이션 탭에 있다
  assert.equal(reports.list().length, 0);
  assert.equal(reports.list('simulation').length, 1);
});

test('P1-6-R8 기본 목록은 analysis·demo:false만, 데모는 별도 탭', async () => {
  const d = dirs();
  await completed('scalp', { d });
  await completed('scalp', { d, demo: true });
  assert.equal(d.reports.list().length, 1);
  assert.equal(d.reports.list('demo').length, 1);
  assert.equal(d.reports.list('demo')[0]!.demo, true);
  assert.match(d.reports.list('demo')[0]!.file, /_DEMO\.json$/);
  const md = readFileSync(d.reports.list('demo')[0]!.file.replace(/\.json$/, '.md'), 'utf8');
  assert.match(md, /DEMO · 실제 데이터 아님/);
});

test('P1-6-R6 대상 파일이 이미 있으면 덮어쓰지 않고 E-DISK로 끝낸다', async () => {
  const d = dirs();
  const r = replayAcquirer('btc-scalp');
  const engine = createEngine({ store: d.jobs, now: () => r.at });
  const job = await engine.createJob({ idempotencyKey: 'k', mode: 'scalp', symbolInput: r.symbol, interface: 'floor' }, r.acquirer);
  floorDrive(engine, job.record.jobId);
  const j = engine.openJob(job.record.jobId);
  const save = reportSaver(d.reports, META, () => r.at);
  let first = '';
  const out = engine.finalize(j, {
    save: (x) => {
      // 같은 작업의 리포트가 이미 저장된 상황 (중복 저장)
      save(structuredClone(x));
      first = d.reports.list()[0]!.file;
      writeFileSync(first, readFileSync(first, 'utf8').replace('"reportSchemaVersion": 3', '"reportSchemaVersion": 3, "marker": true'));
      save(x);
    },
  });
  assert.equal(out, null);
  assert.equal(j.record.state, 'FAILED');
  assert.equal(j.record.error?.code, 'E-DISK');
  assert.match(j.record.error?.detail ?? '', /이미 있음/);
  assert.match(readFileSync(first, 'utf8'), /"marker": true/);
  assert.equal(readdirSync(join(d.root, 'reports')).filter((n) => n.startsWith('.tmp-')).length, 0);
});

test('P1-6-T2 Markdown 이름 변경 직전에 프로세스가 죽어도 반쪽 리포트는 없다 (JSON 기준으로 온전)', async () => {
  const { job } = await completed('scalp');
  const rep = readJson(job.record.report!.json);
  const d = dirs();
  const reportFile = join(d.root, 'report.json');
  writeFileSync(reportFile, JSON.stringify({ ...rep, jobId: '33333333-3333-4333-8333-333333333333' }));
  const child = spawnSync(process.execPath, [new URL('../../fixtures/report-crash.ts', import.meta.url).pathname, join(d.root, 'reports'), reportFile], { encoding: 'utf8' });
  assert.equal(child.signal, 'SIGKILL', child.stderr);
  const names = readdirSync(join(d.root, 'reports'));
  assert.ok(names.some((n) => n === '.tmp-33333333-3333-4333-8333-333333333333.md'), names.join(','));
  assert.ok(!names.some((n) => n.endsWith('.md') && !n.startsWith('.tmp-')));
  // 목록은 JSON 기준: 나타난다면 판정이 온전해야 한다
  const list = d.reports.list();
  assert.equal(list.length, 1);
  const got = d.reports.get('33333333-3333-4333-8333-333333333333')!;
  assert.deepEqual(got.finalDecision, rep.finalDecision);
  // 정리: Markdown을 JSON에서 다시 만들고, 남은 임시 파일은 1시간 뒤 지운다
  const repaired = d.reports.repair();
  assert.equal(repaired.length, 1);
  assert.equal(readFileSync(repaired[0]!, 'utf8'), renderMarkdown(got));
  const tmp = join(d.root, 'reports', '.tmp-33333333-3333-4333-8333-333333333333.md');
  assert.deepEqual(d.reports.cleanupTmp(new Date()), []);
  const old = new Date(Date.now() - 2 * 3600_000);
  utimesSync(tmp, old, old);
  assert.deepEqual(d.reports.cleanupTmp(new Date()), [tmp]); // P1-6-R7
  assert.ok(!existsSync(tmp));
});

test('P1-6-T2 저장 중 Markdown 단계가 실패하면 JSON도 되돌리고 E-DISK', async () => {
  const d = dirs();
  let fail = true;
  const reports = new ReportStore(join(d.root, 'reports'), { tzOffsetMinutes: 0, beforeMdRename: () => { if (fail) throw new Error('디스크 가득 참'); } });
  const r = replayAcquirer('btc-scalp');
  const engine = createEngine({ store: d.jobs, now: () => r.at });
  const job = await engine.createJob({ idempotencyKey: 'k', mode: 'scalp', symbolInput: r.symbol, interface: 'web' }, r.acquirer);
  await runJob(engine, job, autoDriver(), new AbortController().signal, { sleep: noSleep, save: reportSaver(reports, META, () => r.at) });
  assert.equal(job.record.state, 'FAILED');
  assert.equal(job.record.error?.code, 'E-DISK');
  assert.equal(job.record.finalDecision, null);
  assert.deepEqual(readdirSync(join(d.root, 'reports')), []);
  fail = false;
});

test('P1-6-T2 SAVING 중 중단된 작업은 리포트 JSON이 온전히 있으면 재시작 시 COMPLETED로 확정한다', async () => {
  const { job, jobs, engine, reports } = await completed('scalp');
  // SAVING에서 멈춘 것처럼 되돌린다
  const rec = structuredClone(job.record);
  rec.state = 'SAVING';
  rec.history = rec.history.slice(0, -1);
  rec.report = null;
  writeFileSync(join(jobs.root, rec.jobId, 'job.json'), JSON.stringify(rec));
  const ids = engine.recoverInterrupted(() => {}, (id) => reports.get(id) !== null);
  assert.deepEqual(ids, []);
  const after = jobs.load(rec.jobId);
  assert.equal(after.state, 'COMPLETED');
  assert.ok(after.finalDecision);
});

test('P1-6-T3 프롬프트 템플릿의 공백 한 글자를 바꾸면 해당 역할의 프롬프트 해시가 바뀐다', async () => {
  const base = await completed('scalp');
  const dir = mkdtempSync(join(tmpdir(), 'floor-prompts-'));
  cpSync(PROMPT_DIR, dir, { recursive: true });
  const f = join(dir, 'roles', 'TARO.md');
  writeFileSync(f, readFileSync(f, 'utf8') + ' ');
  const changed = await completed('scalp', { prompts: createPromptSet(dir) });
  const a = readJson(base.job.record.report!.json).versions.prompts;
  const b = readJson(changed.job.record.report!.json).versions.prompts;
  assert.notEqual(a.TARO, b.TARO);
  assert.equal(a.VIBE, b.VIBE);
  assert.equal(a.ACE, b.ACE);
});

test('P0-F-T1 /floor 리포트의 snapshotHash가 스냅샷 파일의 해시와 같고, 단일 세션 표시가 있다', async () => {
  const { job } = await completed('scalp', { iface: 'floor' });
  assert.equal(job.record.state, 'COMPLETED');
  const rep = readJson(job.record.report!.json);
  const file = JSON.parse(readFileSync(job.record.snapshot!.path, 'utf8'));
  assert.equal(rep.snapshotHash, hashSnapshot(file));
  assert.equal(rep.snapshotHash, file.snapshotHash);
  assert.equal(rep.interface, 'floor');
  assert.equal(rep.executionBackend, 'single_session');
  assert.equal(rep.analystIndependence, 'shared_context'); // P0-F-R6
  assert.equal(rep.budgetEnforcement, 'partial'); // P0-F-R5
  assert.equal(rep.resultClass, 'analysis'); // lightweight가 아니다
  assert.equal(rep.versions.models.TARO, 'unknown'); // P1-6-R4 세션 모델은 보고되지 않는다
  assert.deepEqual(rep.versions.configuredModels, {});
  assert.equal(rep.usage.roleTurnCount, 5);
  assert.match(readFileSync(job.record.report!.md, 'utf8'), /단일 세션 분석/);
});

test('P0-F-T3 같은 스냅샷을 브라우저 경로와 /floor에 넣으면 단계 수·검증 규칙·스키마가 같다', async () => {
  for (const mode of ['algorithm', 'scalp'] as const) {
    const web = await completed(mode);
    const floor = await completed(mode, { iface: 'floor' });
    const a = readJson(web.job.record.report!.json);
    const b = readJson(floor.job.record.report!.json);
    assert.equal(a.snapshot.dataQuality.status, b.snapshot.dataQuality.status);
    assert.deepEqual(a.snapshot.derived, b.snapshot.derived, mode);
    assert.deepEqual(web.job.record.history.map((h) => h.state), floor.job.record.history.map((h) => h.state), mode);
    assert.equal(a.usage.modelCallCount, b.usage.roleTurnCount, mode);
    assert.deepEqual(a.finalDecision.ruleEngine, b.finalDecision.ruleEngine, mode);
    assert.deepEqual(a.versions.prompts, b.versions.prompts, mode);
    for (const k of ['finalDecision', 'snapshot', 'briefings', 'debate', 'reviews', 'pm', 'proposals', 'riskReview'] as const) assert.deepEqual(shape(a[k]), shape(b[k]), `${mode} ${k}`);
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), mode);
  }
});

test('P0-F-T2 /floor 세션 출력의 롱 손절가를 진입가 위로 바꾸면 리포트 판정이 NO_TRADE + V-DIR-LONG', async () => {
  const d = dirs();
  const r = replayAcquirer('btc-scalp');
  const engine = createEngine({ store: d.jobs, now: () => r.at });
  const job = await engine.createJob({ idempotencyKey: 'k', mode: 'scalp', symbolInput: r.symbol, interface: 'floor' }, r.acquirer);
  floorDrive(engine, job.record.jobId, (role, input) => role === 'ACE' ? sampleProposal(input, { stopLoss: input.priceBasis!.last! * 1.01 }) : sampleOutput(role, input));
  const j = engine.openJob(job.record.jobId);
  engine.finalize(j, { save: reportSaver(d.reports, META, () => r.at) });
  const rep = readJson(j.record.report!.json);
  assert.equal(rep.finalDecision.action, 'NO_TRADE');
  assert.ok(rep.finalDecision.ruleEngine.violations.some((v) => v.code === 'V-DIR-LONG'));
  assert.match(readFileSync(j.record.report!.md, 'utf8'), /V-DIR-LONG/);
});

/** 값이 아니라 키 구조만 비교한다 (배열은 첫 원소의 구조) */
function shape(v: unknown): unknown {
  if (Array.isArray(v)) return v.length ? [shape(v[0])] : [];
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, shape((v as Record<string, unknown>)[k])]));
  return v === null ? null : typeof v;
}

export type { Engine };

test('P0-7-R8 리포트 파일 조회는 ID로만, 실제 경로가 reports/ 밖이면 거부', () => {
  const outside = mkdtempSync(join(tmpdir(), 'floor-outside-'));
  const dir = join(mkdtempSync(join(tmpdir(), 'floor-rep-')), 'reports');
  mkdirSync(dir);
  const id = '33333333-3333-4333-8333-333333333333';
  const fake = { reportSchemaVersion: 1, jobId: id, mode: 'scalp', resultClass: 'analysis', demo: false, completedAt: '2026-09-29T00:00:00Z', finalDecision: { status: 'NO_TRADE' } };
  writeFileSync(join(outside, 'x.json'), JSON.stringify(fake));
  symlinkSync(join(outside, 'x.json'), join(dir, `2026-09-29T00-00-00+09-00_CRYPTO-BTC_scalp_${id.slice(0, 8)}.json`));
  const store = new ReportStore(dir);
  assert.equal(store.locate(id), null);
  assert.equal(store.locate('../../package.json'), null);
  assert.equal(store.get(id), null);
  assert.deepEqual(store.list('analysis'), []);
});
