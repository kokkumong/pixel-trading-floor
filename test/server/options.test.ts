import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PORT, parseServerOptions } from '../../src/server/options.ts';

test('P0-7.1 기본은 로컬 전용 8000번, LAN은 --lan 또는 FLOOR_LAN=1로만 켠다', () => {
  assert.deepEqual(parseServerOptions([], {}), { port: DEFAULT_PORT, mode: 'local', enableProjectZip: false, lanAllowAnalyze: false, open: false });
  assert.equal(DEFAULT_PORT, 8000);
  assert.equal((parseServerOptions(['--lan'], {}) as { mode: string }).mode, 'lan');
  assert.equal((parseServerOptions([], { FLOOR_LAN: '1' }) as { mode: string }).mode, 'lan');
  assert.equal((parseServerOptions([], { FLOOR_LAN: 'yes' }) as { mode: string }).mode, 'local');
  assert.equal((parseServerOptions([], { PORT: '8123' }) as { port: number }).port, 8123);
  assert.equal((parseServerOptions(['--port', '9000'], { PORT: '8123' }) as { port: number }).port, 9000);
  assert.ok('error' in parseServerOptions([], { PORT: 'abc' }));
  assert.ok('error' in parseServerOptions(['--port', '70000'], {}));
  assert.ok('error' in parseServerOptions(['--bogus'], {}));
  assert.equal((parseServerOptions(['--open'], {}) as { open: boolean }).open, true);
  // P0-7-R9: 분석 허용은 LAN 모드에서만 의미가 있다
  assert.ok('error' in parseServerOptions(['--lan-allow-analyze'], {}));
  assert.equal((parseServerOptions(['--lan', '--lan-allow-analyze', '--enable-project-zip'], {}) as { lanAllowAnalyze: boolean }).lanAllowAnalyze, true);
});
