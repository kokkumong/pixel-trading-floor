import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { JobRecord } from '../../src/core/job/record.ts';
import type { CallRecord } from '../../src/core/job/budget.ts';
import { percentile, summarize, toMarkdown } from '../../scripts/measure-budget.ts';

const T0 = Date.parse('2026-09-30T01:00:00Z');
let seq = 0;

/** 순서대로 실행된 호출 기록. 애널리스트는 같은 시각에 시작(병렬) */
function job(mode: JobRecord['mode'], state: JobRecord['state'], calls: [CallRecord['role'], number, number?, number?][], extra: Partial<JobRecord> = {}): JobRecord {
  const start = T0 + seq++ * 3600_000;
  let t = start;
  const recs: CallRecord[] = [];
  for (const [role, dur, input = 5000, output = 2000] of calls) {
    const parallel = ['TARO', 'DIANA', 'NOVA', 'VIBE'].includes(role);
    recs.push({ role, startedAt: new Date(parallel ? start : t).toISOString(), durationSeconds: dur, inputChars: input, outputChars: output, retried: false, outcome: 'ok', modelId: 'claude-sonnet-5-5', usageReported: null });
    if (!parallel) t += dur * 1000;
    else t = Math.max(t, start + dur * 1000);
  }
  return {
    jobId: `j${seq}`, mode, state, demo: false, interface: 'web', executionBackend: 'subprocess_per_role', symbolInput: 'BTC', instrumentId: 'CRYPTO:BTC',
    createdAt: new Date(start).toISOString(), history: [{ state: 'QUEUED', at: new Date(start).toISOString() }, { state, at: new Date(t).toISOString() }],
    usage: { modelCallCount: recs.length, retryCallCount: 0, roleTurnCount: null, calls: recs },
    promptHashes: { TARO: 'aaa', ACE: 'bbb' },
    ...extra,
  } as JobRecord;
}

const scalp = (s: number) => job('scalp', 'COMPLETED', [['TARO', 10 + s], ['VIBE', 8 + s], ['BLITZ', 7 + s], ['GUARD', 6 + s], ['ACE', 9 + s, 12000, 3000]]);

test('percentile: 가장 가까운 순위 방식 (n=10이면 p95·p99는 최댓값)', () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(xs, 50), 5);
  assert.equal(percentile(xs, 95), 10);
  assert.equal(percentile(xs, 99), 10);
  assert.equal(percentile([], 99), null);
});

test('P1-11.2 산출: 역할별 호출 시간 p99×1.5, 순차 경로 p95 합 + 최대 호출 제한, 입력 p99×1.2, 출력 p99×1.5', () => {
  const jobs = Array.from({ length: 10 }, (_, i) => scalp(i));
  const s = summarize(jobs);
  const m = s.modes.scalp!;
  assert.equal(m.sample, 10);
  assert.deepEqual(m.byState, { COMPLETED: 10 });
  // ACE: 9..18초 → p99 18 × 1.5 = 27 (올림)
  assert.equal(m.roles.ACE!.duration.p99, 18);
  assert.equal(m.derived.callTimeoutSeconds.ACE, 27);
  // TARO 10..19 → 28.5 → 29
  assert.equal(m.derived.callTimeoutSeconds.TARO, 29);
  assert.equal(m.derived.callTimeoutMax, 29);
  // 순차 경로: 애널리스트 병렬 단계(p95 = 19) + BLITZ 16 + GUARD 15 + ACE 18 = 68, + 최대 호출 제한 29 = 97
  assert.equal(m.derived.maxDurationSeconds, 68 + 29);
  assert.equal(m.derived.maxInputChars.ACE, 14400);
  assert.equal(m.derived.maxOutputChars.ACE, 4500);
  assert.deepEqual(m.derived.inputOverLimit, []);
  assert.equal(m.final, true);
  assert.deepEqual(m.notes, []);
});

test('P1-11.2 algorithm 순차 경로에는 토론 4발언과 리스크 3명이 각각 들어간다 (조기 종료 표본이라도)', () => {
  const calls: [CallRecord['role'], number][] = [['TARO', 20], ['DIANA', 25], ['NOVA', 22], ['VIBE', 21], ['BULL', 10], ['BEAR', 12], ['ACE', 30], ['RISKY', 5], ['SAFE', 6], ['NEUTRAL', 7], ['PM', 15]];
  const s = summarize(Array.from({ length: 3 }, () => job('algorithm', 'COMPLETED', calls)));
  const d = s.modes.algorithm!.derived;
  // 25(병렬 단계) + 10 + 12 + 10 + 12(토론 4발언) + 30 + 5 + 6 + 7 + 15 = 132, + 최대 호출 제한 ceil(30×1.5)=45
  assert.equal(d.maxDurationSeconds, 132 + 45);
});

test('P1-11-R2 실패율을 종료 상태별로 세고, BUDGET_EXCEEDED가 있으면 산출값을 확정하지 않는다', () => {
  const jobs = [...Array.from({ length: 8 }, (_, i) => scalp(i)), job('scalp', 'BUDGET_EXCEEDED', [['TARO', 10], ['VIBE', 9]]), job('scalp', 'FAILED', [['TARO', 10]])];
  const m = summarize(jobs).modes.scalp!;
  assert.deepEqual(m.byState, { COMPLETED: 8, BUDGET_EXCEEDED: 1, FAILED: 1 });
  assert.equal(m.final, false);
  assert.match(m.notes.join(), /BUDGET_EXCEEDED/);
});

test('P1-11-R3 표본에 모델·프롬프트가 섞여 있으면 재측정 대상으로 표시, 입력 20,000자 초과 역할은 범위 축소 대상', () => {
  const jobs = [scalp(0), scalp(1), { ...scalp(2), promptHashes: { TARO: 'zzz', ACE: 'bbb' } }];
  jobs[0]!.usage.calls[0]!.modelId = 'claude-haiku-4-5';
  jobs[1]!.usage.calls[4]!.inputChars = 19_000; // ACE p99 19,000 × 1.2 = 22,800 > 20,000
  const m = summarize(jobs).modes.scalp!;
  assert.equal(m.final, false);
  assert.match(m.notes.join(), /모델/);
  assert.match(m.notes.join(), /프롬프트/);
  assert.deepEqual(m.derived.inputOverLimit, ['ACE']);
  assert.equal(m.derived.maxInputChars.ACE, 20000); // 상한은 올리지 않는다
  assert.match(m.notes.join(), /표본 3건/); // 10건 미만
});

test('데모·다른 인터페이스 작업은 기본 표본에서 빠지고, /floor는 호출 기록 없이 작업 시간만 센다', () => {
  const floorJob = { ...scalp(0), interface: 'floor', executionBackend: 'single_session', usage: { modelCallCount: 0, retryCallCount: 0, roleTurnCount: 5, calls: [] } } as unknown as JobRecord;
  const jobs = [scalp(0), { ...scalp(1), demo: true }, floorJob];
  assert.equal(summarize(jobs).modes.scalp!.sample, 1);
  const f = summarize(jobs, { interface: 'floor' }).modes.scalp!;
  assert.equal(f.sample, 1);
  assert.deepEqual(f.roles, {});
  assert.ok(f.jobDuration.p95! > 0);
});

test('toMarkdown: 명세 부록에 붙일 표 (날짜·환경·버전·표본 수, P1-11-T2)', () => {
  const md = toMarkdown(summarize(Array.from({ length: 10 }, (_, i) => scalp(i))), { measuredAt: '2026-09-30', environment: 'macOS · Node 24', claudeCliVersion: '2.1.284' });
  assert.match(md, /2026-09-30/);
  assert.match(md, /macOS · Node 24/);
  assert.match(md, /2\.1\.284/);
  assert.match(md, /\| scalp \| 10 \|/);
  assert.match(md, /callTimeoutSeconds/);
  assert.match(md, /claude-sonnet-5-5/);
});
