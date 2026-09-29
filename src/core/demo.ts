// 데모 모드 (P1 명세 8.1). 녹화한 스냅샷 fixture와 역할 응답 fixture를 재생한다.
// 네트워크 계층은 요청 시 즉시 실패하는 BlockedNet, 모델 계층은 FixtureDriver로 바꿔 끼운다 (P1-8-R2).
// 데모 응답도 실전과 같은 submit(스키마 검증)·finalize(규칙 엔진·리포트)를 거친다 (P1-8-R3).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { yahooUsLookup } from './data/adapters.ts';
import { createBlockedNet, type NetClient } from './data/net.ts';
import { InstrumentRegistry } from './data/registry.ts';
import type { SourceRecord } from './data/sources.ts';
import type { Acquirer } from './job/engine.ts';
import { createFixtureDriver } from './model/fixture.ts';
import type { ModelDriver } from './model/driver.ts';
import type { Mode, Role } from './schema/types.ts';

export const DEMO_FIXTURE_VERSION = 'v1';
export const DEMO_DIR = fileURLToPath(new URL(`../../fixtures/demo/${DEMO_FIXTURE_VERSION}/`, import.meta.url));
export const SNAPSHOT_PLACEHOLDER = '{{snapshotId}}';

/** 스냅샷 fixture: 수집 직후 기록과 시각 */
export interface DemoSnapshot {
  name: string;
  symbol: string;
  mode: Mode;
  sourceJobId: string;
  requestedAt: string;
  collectedAt: string;
  records: SourceRecord[];
}

export type DemoResponses = Partial<Record<Role, unknown[]>>;

export interface DemoScenario extends DemoSnapshot {
  fixtureVersion: string;
  responses: DemoResponses;
}

interface Manifest {
  fixtureVersion: string;
  scenarios: Partial<Record<Mode, string>>;
}

export class DemoUnavailableError extends Error {}

function readJson<T>(dir: string, file: string): T {
  return JSON.parse(readFileSync(`${dir}${file}`, 'utf8')) as T;
}

export function demoModes(dir: string = DEMO_DIR): Mode[] {
  return Object.keys(readJson<Manifest>(dir, 'manifest.json').scenarios) as Mode[];
}

export function loadDemo(mode: Mode, dir: string = DEMO_DIR): DemoScenario {
  const m = readJson<Manifest>(dir, 'manifest.json');
  const name = m.scenarios[mode];
  if (!name) throw new DemoUnavailableError(`이 모드의 데모가 없습니다: ${mode} (있는 모드: ${Object.keys(m.scenarios).join(', ')})`);
  const snap = readJson<DemoSnapshot>(dir, `${name}.snapshot.json`);
  return { ...snap, fixtureVersion: m.fixtureVersion, responses: readJson<DemoResponses>(dir, `${name}.responses.json`) };
}

/** 데모 시계: 녹화 시각부터 실제 경과 시간만큼 흐른다 (신선도·유효 기한이 녹화 시점 기준으로 맞는다) */
export function demoClock(s: Pick<DemoSnapshot, 'collectedAt'>, real: () => number = Date.now): () => Date {
  const base = Date.parse(s.collectedAt);
  const start = real();
  return () => new Date(base + (real() - start));
}

/** 데모 데이터 획득기: 종목 해석은 레지스트리(조회 없음), 수집은 fixture 기록. 네트워크는 차단 구현만 연결한다 */
export function demoAcquirer(s: DemoScenario, net: NetClient = createBlockedNet(), registry = new InstrumentRegistry()): Acquirer {
  return {
    registryVersion: registry.version,
    resolve: () => registry.resolveWithLookup(s.symbol, s.mode, yahooUsLookup(net)),
    collect: async () => structuredClone(s.records),
  };
}

/** 응답의 스냅샷 ID 자리표시자를 이번 작업의 스냅샷 ID로 바꿔 재생한다 */
export function demoDriver(s: DemoScenario, snapshotId: string, delayMs = 0): ModelDriver {
  const bound = JSON.parse(JSON.stringify(s.responses).replaceAll(SNAPSHOT_PLACEHOLDER, snapshotId)) as DemoResponses;
  return createFixtureDriver(bound, delayMs);
}
