import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditEvidence, extractNumbers, type AuditInput, type EvidenceIssue } from '../../src/core/rules/audit.ts';
import type { Briefing, DebateMessage } from '../../src/core/schema/agents.ts';
import { evidence, proposal } from '../helpers.ts';

type Claim = Briefing['claims'][number];

function briefing(role: Briefing['role'], claims: Claim[], narrative = ''): Briefing {
  return {
    schemaVersion: 'briefing/1', briefingId: `job:${role}`, role, claims,
    counterScenario: '', changeTriggers: [], dataLimitations: [], bias: 'NEUTRAL', summary: '', narrative,
  };
}
const obs = (claimId: string, text: string, evidenceRefs: string[]): Claim => ({ claimId, kind: 'observation', text, evidenceRefs });

function debate(speaker: 'BULL' | 'BEAR', round: number, evidenceRefs: string[], narrative = '논지'): DebateMessage {
  return { speaker, round, steelman: null, evidenceRefs, openIssues: [], summary: '요약', narrative };
}

const TARO = briefing('TARO', [obs('c1', '현재가 100 부근', ['snap:binance.perp.price#/last']), obs('c2', 'RSI 55', ['derived:rsi14'])]);
const input = (over: Partial<AuditInput>): AuditInput => ({ briefings: [TARO], reviews: [], debate: [], proposals: [], ...over });
const kinds = (xs: EvidenceIssue[]) => xs.map((x) => `${x.kind}:${x.role}:${x.claimId ?? x.round ?? '-'}:${x.ref ?? ''}`);

test('정상 근거는 경고가 없다', () => {
  assert.deepEqual(auditEvidence(input({ debate: [debate('BULL', 1, ['brief:TARO#c1'])], proposals: [proposal()] }), evidence), []);
});

test('P1-10-R1 브리핑·리스크 검토·토론·제안서의 모든 근거 참조를 검사한다', () => {
  const bad = briefing('DIANA', [obs('c1', '펀딩비 관찰', ['snap:binance.perp.funding#/nope'])]);
  const safe = briefing('SAFE', [{ claimId: 'c3', kind: 'interpretation', text: '해석', evidenceRefs: ['derived:ma50'] }]);
  const out = auditEvidence(input({
    briefings: [TARO, bad],
    reviews: [safe],
    debate: [debate('BEAR', 2, ['brief:TARO#c1', 'brief:NOVA#c1'])],
    proposals: [proposal({ evidenceRefs: ['derived:rsi14', 'snap:yahoo.spot.price#/zzz'] })],
  }), evidence);
  assert.deepEqual(kinds(out), [
    'UNRESOLVED_REF:DIANA:c1:snap:binance.perp.funding#/nope',
    'UNRESOLVED_REF:SAFE:c3:derived:ma50', // 값이 null인 지표는 근거가 아니다
    'UNRESOLVED_REF:BEAR:2:brief:NOVA#c1',
    'UNRESOLVED_REF:ACE:-:snap:yahoo.spot.price#/zzz',
  ]);
});

test('P1-10-T2 존재하지 않는 snap: 참조를 넣은 주장은 근거 확인 불가로 표시된다', () => {
  const out = auditEvidence(input({ briefings: [briefing('TARO', [obs('c1', '가격', ['snap:binance.perp.price#/nope'])])] }), evidence);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.label, '근거 확인 불가');
  assert.equal(out[0]!.claimId, 'c1');
});

test('P1-10-R3 observation 수치가 참조 값과 0.5% 이상 다르면 수치 불일치', () => {
  const claims = [
    obs('c1', '현재가 103.0', ['snap:binance.perp.price#/last']), // 3% 차이
    obs('c2', '14일 RSI 55', ['derived:rsi14']), // 14는 참조 값과 무관, 55는 일치
    obs('c3', '펀딩비 0.01%', ['snap:binance.perp.funding#/rate']), // 0.0001 = 0.01%
    obs('c4', '현물 134.1만원', ['snap:yahoo.spot.price#/last']),
    obs('c5', '현물 136만원', ['snap:yahoo.spot.price#/last']), // 1.4% 차이
    obs('c6', 'RSI 55.4', ['derived:rsi14']), // 반올림으로 설명되지 않는 0.7%
    obs('c7', '마크 가격 100.1, 최근가 100', ['snap:binance.perp.price#']), // 객체 참조는 한 단계 숫자 필드와 비교
    { claimId: 'c8', kind: 'interpretation', text: '현재가 103', evidenceRefs: ['snap:binance.perp.price#/last'] },
  ] satisfies Claim[];
  const out = auditEvidence(input({ briefings: [briefing('TARO', claims)] }), evidence);
  assert.deepEqual(out.map((x) => `${x.kind}:${x.claimId}`), ['VALUE_MISMATCH:c1', 'VALUE_MISMATCH:c5', 'VALUE_MISMATCH:c6']);
  assert.equal(out[0]!.label, '수치 불일치');
  assert.match(out[0]!.detail, /103\.0.*100/);
});

test('P1-10-R5 BULL·BEAR는 brief: 인용이 있어야 하고, 브리핑에 없는 새 수치는 snap:·derived: 근거가 있어야 한다', () => {
  const out = auditEvidence(input({
    debate: [
      debate('BULL', 1, ['derived:rsi14']), // brief: 인용 없음
      debate('BEAR', 1, ['brief:TARO#c1'], '100을 지키지 못하면 97까지 밀린다. 2라운드 쟁점'), // 97은 새 수치, 2는 작은 정수라 제외
      debate('BULL', 2, ['brief:TARO#c2'], 'RSI 55와 가격 100.0은 브리핑 그대로'),
      debate('BEAR', 2, ['brief:TARO#c1', 'snap:binance.perp.price#/mark'], '마크 100.1'),
    ],
  }), evidence);
  assert.deepEqual(out.map((x) => `${x.kind}:${x.role}:${x.round}`), ['NO_BRIEF_REF:BULL:1', 'UNSOURCED_NUMBER:BEAR:1']);
  assert.match(out[1]!.detail, /97/);
  assert.doesNotMatch(out[1]!.detail, /100/);
});

test('숫자 추출: 천 단위 쉼표, 소수, %·만·억, 식별자 속 숫자 제외', () => {
  const ns = extractNumbers('rsi14 대신 RSI 72, 가격 1,341,000원(134.1만), 펀딩 -0.01%, 시총 3.2억, ma50');
  assert.deepEqual(ns.map((n) => n.text), ['72', '1,341,000', '134.1만', '0.01%', '3.2억']);
});
