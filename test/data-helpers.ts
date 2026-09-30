import { readFileSync } from 'node:fs';
import { resetFundingCache, yahooUsLookup } from '../src/core/data/adapters.ts';
import { createFixtureNet, NetError } from '../src/core/data/net.ts';
import { InstrumentRegistry } from '../src/core/data/registry.ts';
import { collectSnapshot, collectSources, type AnalysisSnapshot } from '../src/core/data/snapshot.ts';
import type { Acquirer } from '../src/core/job/engine.ts';
import type { Mode } from '../src/core/schema/types.ts';

export const registry = new InstrumentRegistry();

export interface Recording {
  recordedAt: string;
  symbol: string;
  mode: Mode;
  responses: Record<string, string>;
}

export function loadRecording(name: string): Recording {
  return JSON.parse(readFileSync(new URL(`../fixtures/test/http/${name}.json`, import.meta.url), 'utf8'));
}

export interface ReplayOptions {
  fail?: string[];
  patch?: (url: string, body: string) => string;
  shiftMs?: number;
}

/** 녹화된 응답을 돌려주는 가짜 네트워크. fail에 준 URL 조각이 들어간 요청은 실패시키고, patch로 응답 본문을 바꾼다 */
export function replayNet(name: string, opts: ReplayOptions = {}) {
  const rec = loadRecording(name);
  const responses: Record<string, string | NetError> = {};
  for (const [url, body] of Object.entries(rec.responses)) {
    responses[url] = opts.fail?.some((f) => url.includes(f)) ? new NetError('NET_HTTP', `주입 실패 ${url}`) : opts.patch ? opts.patch(url, body) : body;
  }
  resetFundingCache();
  return { rec, net: createFixtureNet(responses, rec.recordedAt), at: new Date(Date.parse(rec.recordedAt) + (opts.shiftMs ?? 0)) };
}

/**
 * 녹화된 응답을 재생해 스냅샷을 만든다. 시계는 녹화 시각 + shiftMs.
 */
export async function replaySnapshot(name: string, opts: ReplayOptions = {}): Promise<{ snap: AnalysisSnapshot; requests: string[] }> {
  const { rec, net, at } = replayNet(name, opts);
  const res = await registry.resolveWithLookup(rec.symbol, rec.mode, yahooUsLookup(net));
  if (!res.ok) throw new Error('fixture 종목 해석 실패');
  const snap = await collectSnapshot(net, {
    jobId: 'job-test', mode: rec.mode, symbolInput: rec.symbol, instrument: res.instrument, marketType: res.marketType,
    registryVersion: registry.version, requestedAt: at, snapshotId: 'snap-test',
  }, () => at);
  return { snap, requests: net.requests };
}

/** 작업 엔진용 데이터 획득기: 녹화된 응답으로 종목 해석과 소스 수집을 한다. symbol을 주면 녹화 종목 대신 그 입력을 해석한다 */
export function replayAcquirer(name: string, opts: ReplayOptions & { symbol?: string } = {}): { acquirer: Acquirer; at: Date; mode: Mode; symbol: string; net: ReturnType<typeof replayNet>['net'] } {
  const { rec, net, at } = replayNet(name, opts);
  const symbol = opts.symbol ?? rec.symbol;
  return {
    at, mode: rec.mode, symbol, net,
    acquirer: {
      registryVersion: registry.version,
      resolve: () => registry.resolveWithLookup(symbol, rec.mode, yahooUsLookup(net)),
      collect: (inst) => collectSources(net, inst, rec.mode, () => at),
    },
  };
}
