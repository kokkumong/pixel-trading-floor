// 서버 테스트 도구: 녹화 데이터·자동 드라이버로 도는 JobManager
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Mode } from '../../src/core/schema/types.ts';
import { JobManager, type JobManagerOptions } from '../../src/server/jobs.ts';
import { replayAcquirer } from '../data-helpers.ts';
import { autoDriver } from '../job-helpers.ts';

export const FIXTURE: Record<Mode, string> = { algorithm: 'btc-algorithm', scalp: 'btc-scalp', forced_direction: 'btc-scalp' };
export const FAKE = fileURLToPath(new URL('../fixtures/fake-claude.mjs', import.meta.url));

export function manager(over: Partial<JobManagerOptions> & { root?: string } = {}) {
  const root = over.root ?? mkdtempSync(join(tmpdir(), 'floor-srv-'));
  const at = replayAcquirer('btc-scalp').at;
  const m = new JobManager({
    root, env: {}, now: () => at, tzOffsetMinutes: 540, maxConcurrentJobs: 1,
    acquirer: (symbol, mode) => replayAcquirer(FIXTURE[mode], { symbol }).acquirer,
    driver: () => autoDriver(),
    checkClaude: async () => ({ ok: true }),
    claudeVersion: async () => '2.1.284 (Claude Code)',
    demoDelayMs: 0,
    ...over,
  });
  return { m, root };
}

