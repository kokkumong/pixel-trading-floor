import { readFileSync } from 'node:fs';
import { resetFundingCache, yahooUsLookup } from '../src/core/data/adapters.ts';
import { createFixtureNet, NetError } from '../src/core/data/net.ts';
import { InstrumentRegistry } from '../src/core/data/registry.ts';
import { collectSnapshot, type AnalysisSnapshot } from '../src/core/data/snapshot.ts';
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

/**
 * 녹화된 응답을 재생해 스냅샷을 만든다. fail에 준 URL 조각이 들어간 요청은 실패시키고,
 * patch로 응답 본문을 바꿀 수 있다. 시계는 녹화 시각 + shiftMs.
 */
export async function replaySnapshot(
  name: string,
  opts: { fail?: string[]; patch?: (url: string, body: string) => string; shiftMs?: number } = {},
): Promise<{ snap: AnalysisSnapshot; requests: string[] }> {
  const rec = loadRecording(name);
  const responses: Record<string, string | NetError> = {};
  for (const [url, body] of Object.entries(rec.responses)) {
    responses[url] = opts.fail?.some((f) => url.includes(f)) ? new NetError('NET_HTTP', `주입 실패 ${url}`) : opts.patch ? opts.patch(url, body) : body;
  }
  const net = createFixtureNet(responses, rec.recordedAt);
  resetFundingCache();
  const res = await registry.resolveWithLookup(rec.symbol, rec.mode, yahooUsLookup(net));
  if (!res.ok) throw new Error('fixture 종목 해석 실패');
  const at = new Date(Date.parse(rec.recordedAt) + (opts.shiftMs ?? 0));
  const snap = await collectSnapshot(net, {
    jobId: 'job-test', mode: rec.mode, symbolInput: rec.symbol, instrument: res.instrument, marketType: res.marketType,
    registryVersion: registry.version, requestedAt: at, snapshotId: 'snap-test',
  }, () => at);
  return { snap, requests: net.requests };
}
