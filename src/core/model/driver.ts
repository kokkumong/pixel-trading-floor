// 역할 출력을 만드는 방법을 추상화한다. 브라우저 경로는 ClaudeCliDriver, 데모는 FixtureDriver, 테스트는 ScriptedDriver.
// (/floor 경로는 드라이버 없이 세션이 submit한다, P1-5)
import type { Role } from '../schema/types.ts';
import type { ErrorCode } from './errors.ts';

export interface ModelRequest {
  role: Role;
  systemPrompt: string;
  input: string; // 역할 입력 (표준 입력으로 전달)
  jsonSchema: Record<string, unknown>;
  model: string;
  /** claude --effort. 사고(thinking) 토큰과 지연을 줄인다. 없으면 CLI 기본값 */
  effort?: 'low' | 'medium' | 'high';
  timeoutMs: number;
  maxOutputChars: number;
}

export interface ModelUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}

export type ModelResult =
  | { ok: true; output: unknown; outputChars: number; modelId: string; usage: ModelUsage; durationMs: number }
  | { ok: false; code: ErrorCode; detail: string; durationMs: number };

export interface ModelDriver {
  readonly kind: 'claude-cli' | 'fixture' | 'scripted';
  /** 실제 모델 호출로 셀지 (데모 재생은 modelCallCount = 0, P0-1-R4) */
  readonly countsAsModelCall: boolean;
  call(req: ModelRequest, signal: AbortSignal): Promise<ModelResult>;
}
