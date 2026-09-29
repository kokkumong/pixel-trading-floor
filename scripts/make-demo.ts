// 실제로 끝난 작업(jobs/<jobId>)을 데모 fixture로 바꾼다 (P1-8-R1).
//   node scripts/make-demo.ts <jobId> <이름>   → fixtures/demo/<버전>/<이름>.snapshot.json, <이름>.responses.json
// 스냅샷 fixture: 수집 기록(SourceRecord)과 시각. 데모 실행 때 같은 assembleSnapshot을 다시 거친다.
// 응답 fixture: 역할별 모델 출력(시스템이 붙인 식별 정보를 뺀 원래 형태). 스냅샷 ID는 {{snapshotId}}로 바꿔 둔다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnalysisSnapshot } from '../src/core/data/snapshot.ts';
import type { CandlePayload, SourceRecord } from '../src/core/data/sources.ts';
import { DEMO_DIR, SNAPSHOT_PLACEHOLDER, type DemoResponses, type DemoSnapshot } from '../src/core/demo.ts';
import type { JobRecord } from '../src/core/job/record.ts';
import type { Briefing, DebateMessage } from '../src/core/schema/agents.ts';
import type { TradeProposal } from '../src/core/schema/proposal.ts';

const [jobId, name] = process.argv.slice(2);
if (!jobId || !name || !/^[a-z0-9-]+$/.test(name)) {
  console.error('사용법: node scripts/make-demo.ts <jobId> <이름(영문 소문자·숫자·-)>');
  process.exit(1);
}
const dir = new URL(`../jobs/${jobId}/`, import.meta.url).pathname;
const rec = JSON.parse(readFileSync(join(dir, 'job.json'), 'utf8')) as JobRecord;
const snap = JSON.parse(readFileSync(join(dir, 'snapshot.json'), 'utf8')) as AnalysisSnapshot;
if (rec.state !== 'COMPLETED') throw new Error(`COMPLETED 작업만 데모로 만들 수 있음: ${rec.state}`);

/** 스냅샷 안의 소스 → 수집 직후 기록. 무결성 검사에서 떼어 낸 미완성 봉은 되돌리고, 추정 시세는 다시 계산되므로 뺀다 */
function toRecord(s: AnalysisSnapshot['sources'][number]): SourceRecord {
  const { required: _r, ageSeconds: _a, ttlSeconds: _t, freshness: _f, stale: _s, usable: _u, ...raw } = s;
  if (raw.endpointType === 'candle' && raw.payload) {
    const p = raw.payload as CandlePayload;
    const candles = p.current ? [...p.candles, (({ incomplete: _i, ...c }) => c)(p.current as typeof p.current & { incomplete?: boolean })] : p.candles;
    raw.payload = { interval: p.interval, candles };
  }
  return raw;
}

const strip = <T extends object>(o: T, keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const briefing = (b: Briefing) => strip(b, ['schemaVersion', 'briefingId', 'role']);
const proposal = (p: TradeProposal) => strip(p, ['schemaVersion', 'jobId', 'author']);
const debate = (m: DebateMessage) => strip(m, ['speaker', 'round']);

const o = rec.outputs;
const responses: DemoResponses = {};
for (const b of Object.values(o.briefings)) if (b) responses[b.role] = [briefing(b)];
for (const b of o.reviews) responses[b.role] = [briefing(b)];
for (const m of o.debate) (responses[m.speaker] ??= []).push(debate(m));
if (o.blitzPlan) responses.BLITZ = [proposal(o.blitzPlan)];
if (o.proposal) responses.ACE = [proposal(o.proposal)];
if (o.pm) {
  responses.PM = [{
    pmDecision: o.pm.pmDecision, modifiedFields: o.pm.reportedModifiedFields, reasonCodes: o.pm.reasonCodes,
    revisedProposal: o.pm.revisedProposal ? proposal(o.pm.revisedProposal) : null, summary: o.pm.summary, narrative: o.pm.narrative,
  }];
}

const fixture: DemoSnapshot = {
  name, symbol: rec.symbolInput, mode: rec.mode, sourceJobId: rec.jobId, requestedAt: snap.requestedAt, collectedAt: snap.collectedAt,
  records: snap.sources.filter((s) => s.provider !== 'estimate').map(toRecord),
};
const out = DEMO_DIR;
mkdirSync(out, { recursive: true });
writeFileSync(join(out, `${name}.snapshot.json`), JSON.stringify(fixture, null, 2) + '\n');
writeFileSync(join(out, `${name}.responses.json`), JSON.stringify(responses, null, 2).replaceAll(snap.snapshotId, SNAPSHOT_PLACEHOLDER) + '\n');
console.log(`${out}${name}.{snapshot,responses}.json · ${rec.mode} · 역할 ${Object.keys(responses).join(', ')}`);
