// 실제 데이터와 실제 claude로 작업 하나를 끝까지 실행한다 (수동 스모크 테스트·P1-11 실측용). 테스트에서는 쓰지 않는다.
//   node scripts/run-job.ts <종목> [algorithm|scalp|forced_direction]
// 작업 기록은 jobs/<jobId>/에 남는다. Ctrl-C로 취소하면 claude 하위 프로세스를 그룹째 종료한다.
import { yahooUsLookup } from '../src/core/data/adapters.ts';
import { createRealNet } from '../src/core/data/net.ts';
import { InstrumentRegistry } from '../src/core/data/registry.ts';
import { collectSources } from '../src/core/data/snapshot.ts';
import { createEngine } from '../src/core/job/engine.ts';
import { runJob } from '../src/core/job/runner.ts';
import { JobStore } from '../src/core/job/store.ts';
import { createClaudeCliDriver } from '../src/core/model/claude-cli.ts';
import type { ModelDriver } from '../src/core/model/driver.ts';
import { actionBiasLabel, panelView } from '../src/core/rules/display.ts';
import { MODES, type Mode } from '../src/core/schema/types.ts';

const [symbol = 'BTC', modeArg = 'scalp'] = process.argv.slice(2);
const mode = (MODES as readonly string[]).includes(modeArg) ? (modeArg as Mode) : 'scalp';
const net = createRealNet();
const registry = new InstrumentRegistry();
const engine = createEngine({ store: new JobStore(new URL('../jobs/', import.meta.url).pathname) });
const t0 = Date.now();
const sec = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6);

const job = await engine.createJob({ idempotencyKey: `cli-${Date.now()}`, mode, symbolInput: symbol, interface: 'web' }, {
  registryVersion: registry.version,
  resolve: () => registry.resolveWithLookup(symbol, mode, yahooUsLookup(net)),
  collect: (inst) => collectSources(net, inst, mode),
});
console.log(`${sec()}s 작업 ${job.record.jobId} · ${job.record.instrumentId ?? symbol} · ${mode} · ${job.record.state}`);
if (job.record.error) console.log(`         ${job.record.error.code}: ${job.record.error.detail}`);

const cli = createClaudeCliDriver({ onSpawn: (pid) => engine.trackPid(job, pid), onExit: (pid) => engine.untrackPid(job, pid) });
const driver: ModelDriver = {
  ...cli,
  async call(req, signal) {
    console.log(`${sec()}s → ${req.role} (${req.model}, effort ${req.effort ?? '-'}, 입력 ${req.systemPrompt.length + req.input.length}자)`);
    const r = await cli.call(req, signal);
    console.log(`${sec()}s ← ${req.role} ${r.ok ? `ok ${r.outputChars}자 · ${r.modelId} · 출력 ${r.usage.outputTokens ?? '?'}토큰 · $${r.usage.costUsd ?? '?'}` : `${r.code} ${r.detail}`} (${(r.durationMs / 1000).toFixed(1)}초)`);
    return r;
  },
};
const ac = new AbortController();
process.on('SIGINT', () => ac.abort());
await runJob(engine, job, driver, ac.signal);

const r = job.record;
const d = r.finalDecision;
console.log(`\n상태 ${r.state}${r.error ? ` · ${r.error.code} (${r.error.role ?? '-'}): ${r.error.detail}` : ''}`);
console.log(`호출 ${r.usage.modelCallCount}회 (계획 ${r.plannedModelCallRange.min}~${r.plannedModelCallRange.max}, 재시도 ${r.usage.retryCallCount}) · 토론 ${r.debate.roundCount}라운드 ${r.debate.stopReason ?? ''}`);
const cost = r.usage.calls.reduce((s, c) => s + (c.usageReported?.costUsd ?? 0), 0);
const out = r.usage.calls.reduce((s, c) => s + (c.usageReported?.outputTokens ?? 0), 0);
console.log(`총 ${sec().trim()}초 · 출력 ${out}토큰 · 보고 비용 $${cost.toFixed(4)}`);
if (d && d.action && d.bias) {
  const v = panelView(d);
  console.log(`\n[${v.badges.join('] [')}] ${v.title}\n  ${v.headline} (${actionBiasLabel(d.action, d.bias)}) · 확신도 ${d.confidence?.band ?? '-'}`);
  for (const n of v.notes) console.log(`  · ${n}`);
  if (d.proposal) console.log(`  진입 ${d.proposal.entry.type} ${d.proposal.entry.min}~${d.proposal.entry.max} · 손절 ${d.proposal.stopLoss} · 목표 ${d.proposal.targets.join(', ')} · 근거 ${d.proposal.evidenceRefs.join(', ')}`);
  for (const x of d.ruleEngine.violations) console.log(`  ✗ ${x.code}: ${x.message}`);
  for (const w of d.ruleEngine.warnings) console.log(`  ⚠ ${w}`);
}
