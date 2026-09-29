// 개발용: 실제 공급자 응답을 녹화해 fixtures/test/http/<이름>.json으로 저장한다.
// 테스트는 이 파일을 createFixtureNet으로 재생해 어댑터와 스냅샷 조립을 네트워크 없이 검증한다.
//   node scripts/record-fixtures.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { resetFundingCache, yahooUsLookup } from '../src/core/data/adapters.ts';
import { createRealNet, type NetClient } from '../src/core/data/net.ts';
import { InstrumentRegistry } from '../src/core/data/registry.ts';
import { assembleSnapshot, collectSources } from '../src/core/data/snapshot.ts';
import type { Mode } from '../src/core/schema/types.ts';

const cases: [string, string, Mode][] = [
  ['btc-scalp', 'BTC', 'scalp'],
  ['btc-algorithm', 'BTC', 'algorithm'],
  ['hynix-algorithm', '하이닉스', 'algorithm'],
  ['hynix-scalp', 'SK하이닉스', 'scalp'],
  ['tsla-algorithm', 'TSLA', 'algorithm'],
];

const real = createRealNet();
const registry = new InstrumentRegistry();
mkdirSync('fixtures/test/http', { recursive: true });

for (const [name, symbol, mode] of cases) {
  const responses: Record<string, string> = {};
  const recording: NetClient = {
    kind: 'real',
    async get(url, expect) {
      const r = await real.get(url, expect);
      responses[url] = r.body;
      return r;
    },
  };
  resetFundingCache();
  const res = await registry.resolveWithLookup(symbol, mode, yahooUsLookup(recording));
  if (!res.ok) {
    console.log(name, 'resolve 실패', res);
    continue;
  }
  const recordedAt = new Date();
  const records = await collectSources(recording, res.instrument, mode, () => recordedAt);
  const snap = assembleSnapshot({
    jobId: 'rec', mode, symbolInput: symbol, instrument: res.instrument, marketType: res.marketType,
    registryVersion: registry.version, requestedAt: recordedAt, collectedAt: recordedAt, records,
  });
  writeFileSync(`fixtures/test/http/${name}.json`, JSON.stringify({ recordedAt: recordedAt.toISOString(), symbol, mode, responses }) + '\n');
  console.log(`${name}: ${res.description} | ${snap.dataQuality.status} ${snap.dataQuality.requiredOk} | 요청 ${Object.keys(responses).length}건`);
  for (const s of snap.sources) console.log(`   ${s.required ? '필수' : '선택'} ${s.id} ${s.status} ${s.freshness} age=${s.ageSeconds} usable=${s.usable}${s.error ? ' ' + s.error : ''}`);
  for (const w of snap.dataQuality.warnings) console.log('   ⚠', w);
  const ind = snap.derived.indicators;
  console.log('   지표', ind && { bars: ind.bars, rsi14: ind.rsi14?.toFixed(2), sma20: ind.sma20, atr14: ind.atr14, basis: ind.basis }, '괴리', snap.derived.spreads.map((x) => x.value));
}
