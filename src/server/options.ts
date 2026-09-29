// 서버 시작 인자 (P0 명세 7.1, 가이드 2-4). 기본은 로컬 전용 127.0.0.1:8000.
import { parseArgs } from 'node:util';
import type { ServerMode } from './security.ts';

export const DEFAULT_PORT = 8000;

export interface ServerOptions {
  port: number;
  mode: ServerMode;
  /** P0-7.4: /project.zip은 이 인자가 있을 때 로컬에서만 */
  enableProjectZip: boolean;
  /** P0-7-R9 (선택): LAN 기기의 분석 실행 허용. 가이드에 소개하지 않는다 */
  lanAllowAnalyze: boolean;
  /** 시작한 뒤 로컬 토큰 주소로 기본 브라우저를 연다 (시작 스크립트용: 주소를 파일로 남기지 않는다) */
  open: boolean;
}

export function parsePort(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  if (!/^\d{1,5}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= 65535 ? n : null; // 0은 빈 포트 아무거나 (테스트용)
}

export function parseServerOptions(argv: string[], env: NodeJS.ProcessEnv): ServerOptions | { error: string } {
  let v: Record<string, string | boolean | undefined>;
  try {
    v = parseArgs({
      args: argv, strict: true, allowPositionals: false,
      options: { lan: { type: 'boolean' }, port: { type: 'string' }, 'enable-project-zip': { type: 'boolean' }, 'lan-allow-analyze': { type: 'boolean' }, open: { type: 'boolean' } },
    }).values as Record<string, string | boolean | undefined>;
  } catch (e) {
    return { error: (e as Error).message };
  }
  const portRaw = typeof v.port === 'string' ? v.port : env.PORT;
  const port = parsePort(portRaw);
  if (port === null) return { error: `포트가 잘못되었습니다: ${String(portRaw).slice(0, 20)} (0~65535)` };
  const mode: ServerMode = v.lan === true || env.FLOOR_LAN === '1' ? 'lan' : 'local';
  const lanAllowAnalyze = v['lan-allow-analyze'] === true;
  if (lanAllowAnalyze && mode !== 'lan') return { error: '--lan-allow-analyze는 --lan과 함께만 쓸 수 있습니다' };
  return { port, mode, enableProjectZip: v['enable-project-zip'] === true, lanAllowAnalyze, open: v.open === true };
}
