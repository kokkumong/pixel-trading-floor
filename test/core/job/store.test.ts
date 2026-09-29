import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newJobRecord } from '../../../src/core/job/record.ts';
import { JobStateError, transition } from '../../../src/core/job/state.ts';
import { JobStore } from '../../../src/core/job/store.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'floor-store-'));
const rec = (jobId: string = randomUUID()) =>
  newJobRecord({ jobId, idempotencyKey: 'k1', mode: 'scalp', symbolInput: 'BTC', interface: 'web' }, new Date('2026-09-29T00:00:00Z'));

test('P1-1-R2 작업 기록은 jobs/<jobId>/job.json에 필요한 필드를 담는다', () => {
  const root = tmp();
  const store = new JobStore(root);
  const r = rec();
  store.create(r);
  const disk = JSON.parse(readFileSync(join(root, r.jobId, 'job.json'), 'utf8'));
  for (const k of ['jobId', 'idempotencyKey', 'mode', 'instrumentId', 'state', 'history', 'usage', 'error', 'snapshot', 'pids']) assert.ok(k in disk, k);
  assert.equal(disk.state, 'QUEUED');
  assert.deepEqual(disk.history.map((h: { state: string }) => h.state), ['QUEUED']);
  assert.deepEqual(disk.plannedModelCallRange, { min: 5, max: 5 });
  assert.deepEqual(store.load(r.jobId), r);
  assert.throws(() => store.create(r), /이미 있음/); // 같은 jobId로 새 작업을 만들지 않는다
});

test('P1-1-R1 갱신은 원자적이다: 임시 파일이 남지 않고, 파일은 항상 완전한 JSON', () => {
  const root = tmp();
  const store = new JobStore(root);
  const r = rec();
  store.create(r);
  for (const s of ['COLLECTING_DATA', 'VALIDATING_DATA'] as const) {
    transition(r, s, new Date());
    store.save(r);
    assert.equal(store.load(r.jobId).state, s);
  }
  assert.deepEqual(readdirSync(join(root, r.jobId)), ['job.json']);
  const p = store.writeJson(r.jobId, 'inputs/TARO.json', { a: 1 });
  assert.equal(p, join(root, r.jobId, 'inputs', 'TARO.json'));
  assert.deepEqual(store.readJson(r.jobId, 'inputs/TARO.json'), { a: 1 });
  assert.deepEqual(readdirSync(join(root, r.jobId, 'inputs')), ['TARO.json']);
});

test('P1-1-T4 디스크의 작업이 종료 상태면 저장을 거부한다', () => {
  const store = new JobStore(tmp());
  const r = rec();
  store.create(r);
  transition(r, 'CANCELLED', new Date());
  store.save(r);
  const stale = rec(r.jobId); // 종료 전 사본으로 덮어쓰려는 시도
  assert.throws(() => store.save(stale), JobStateError);
  assert.equal(store.load(r.jobId).state, 'CANCELLED');
});

test('jobId는 UUID만 받는다 (경로 조작 방지)', () => {
  const store = new JobStore(tmp());
  for (const id of ['../x', 'a/b', '', '..', 'not-a-uuid']) assert.throws(() => store.load(id), /jobId/, id);
  assert.throws(() => store.writeJson(randomUUID(), '../escape.json', {}), /경로/);
});

test('list는 기록된 작업을 모두 돌려주고 깨진 기록은 건너뛴다', () => {
  const store = new JobStore(tmp());
  const a = rec();
  const b = rec();
  store.create(a);
  store.create(b);
  assert.deepEqual(store.list().map((x) => x.jobId).sort(), [a.jobId, b.jobId].sort());
});
