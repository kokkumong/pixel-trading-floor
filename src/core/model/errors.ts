// 오류 코드와 사용자 안내 (P1 명세 1.5), 재시도 대상 분류 (P0 명세 8.4).

export const ERROR_CODES = {
  'E-CLI-MISSING': { status: 'FAILED', message: 'Claude Code가 설치되지 않았거나 경로에서 찾을 수 없습니다. 진단 페이지를 여세요' },
  'E-AUTH': { status: 'FAILED', message: 'Claude 로그인이 필요하거나 만료되었습니다. 터미널에서 claude를 실행해 로그인하세요' },
  'E-QUOTA': { status: 'FAILED', message: 'Claude 사용량 한도에 도달했습니다. 한도가 초기화된 뒤 다시 시도하세요' },
  'E-TIMEOUT': { status: 'BUDGET_EXCEEDED', message: '응답이 시간 제한을 넘었습니다' },
  'E-SCHEMA': { status: 'SCHEMA_ERROR', message: '응답 형식이 잘못되어 판정을 만들 수 없습니다' },
  'E-CLI-CRASH': { status: 'FAILED', message: 'Claude 프로세스가 비정상 종료되었습니다' },
  'E-DATA-REQUIRED': { status: 'INSUFFICIENT_DATA', message: '필수 데이터를 가져오지 못했거나 오래되었습니다' },
  'E-UNSUPPORTED-SYMBOL': { status: 'UNSUPPORTED_SYMBOL', message: '지원하지 않는 종목이거나 이 모드에서 분석할 수 없는 종목입니다' },
  'E-BUDGET': { status: 'BUDGET_EXCEEDED', message: '호출·시간 상한에 도달해 중단했습니다' },
  'E-CLOCK': { status: 'FAILED', message: 'PC 시계가 실제 시각과 크게 다릅니다' },
  'E-DISK': { status: 'FAILED', message: '리포트를 저장할 수 없습니다 (권한·공간 확인)' },
  'E-CANCELLED': { status: 'CANCELLED', message: '사용자가 취소했습니다' },
  'E-INTERRUPTED': { status: 'INTERRUPTED', message: '서버가 종료되어 분석이 중단되었습니다' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class FloorError extends Error {
  readonly code: ErrorCode;
  readonly detail: string | undefined;
  constructor(code: ErrorCode, detail?: string) {
    super(detail ? `${ERROR_CODES[code].message} (${detail})` : ERROR_CODES[code].message);
    this.code = code;
    this.detail = detail;
  }
}

/** 재시도 대상 (P0 명세 8.4): 시간 초과, 스키마 오류, 프로세스 비정상 종료. 인증·사용량·취소는 재시도하지 않는다 */
export function isRetryable(code: ErrorCode): boolean {
  return code === 'E-TIMEOUT' || code === 'E-SCHEMA' || code === 'E-CLI-CRASH';
}

const AUTH = /(not logged in|please log ?in|\/login|log in to|authenticat|unauthori[sz]ed|invalid api key|invalid x-api-key|oauth token|token (has )?expired|\b401\b)/i;
const QUOTA = /(usage limit|rate limit|limit reached|quota|credit balance|too many requests|\b429\b|limit will reset)/i;

/** CLI 실패 텍스트(표준 오류, result 문자열)와 API 상태 코드로 오류 코드를 정한다 */
export function classifyCliFailure(text: string, apiStatus: number | null): ErrorCode {
  if (apiStatus === 401 || apiStatus === 403 || AUTH.test(text)) return 'E-AUTH';
  if (apiStatus === 429 || QUOTA.test(text)) return 'E-QUOTA';
  return 'E-CLI-CRASH';
}
