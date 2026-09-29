import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_VERSION } from '../src/core/version.ts';

test('타입 제거 실행과 .ts import가 동작한다', () => {
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
});
