import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBriefing, checkPm } from '../../src/core/schema/agents.ts';
import { parse, toJsonSchema, obj, str, nul, int } from '../../src/core/schema/dsl.ts';
import { checkProposal, diffProposalFields, ProposalOutputSchema } from '../../src/core/schema/proposal.ts';
import { JOB, proposalCtx, proposalOutput } from '../helpers.ts';

const codes = (r: { ok: boolean; errors?: { code: string }[] }) => (r.ok ? [] : r.errors!.map((e) => e.code));

test('정상 제안서는 통과하고 시스템 필드가 붙는다', () => {
  const r = checkProposal(proposalOutput(), proposalCtx());
  assert.ok(r.ok);
  assert.equal(r.proposal.schemaVersion, 'proposal/2');
  assert.equal(r.proposal.jobId, JOB);
  assert.equal(r.proposal.author, 'ACE');
});

test('P0-3-T3 잘린 JSON, 누락 필드, NaN, 음수 가격, 확신도 150은 모두 스키마 오류', () => {
  const text = JSON.stringify(proposalOutput());
  assert.deepEqual(codes(checkProposal(text.slice(0, text.length - 10), proposalCtx())), ['V-PARSE']);

  const { stopLoss: _drop, ...missing } = proposalOutput();
  assert.deepEqual(codes(checkProposal(missing, proposalCtx())), ['V-PARSE']);

  assert.deepEqual(codes(checkProposal(proposalOutput({ stopLoss: Number.NaN }), proposalCtx())), ['V-POSITIVE']);
  assert.deepEqual(codes(checkProposal(proposalOutput({ targets: [104, -5] }), proposalCtx())), ['V-POSITIVE']);
  assert.deepEqual(codes(checkProposal(proposalOutput({ confidence: 150 }), proposalCtx())), ['V-CONF']);
  assert.deepEqual(codes(checkProposal(proposalOutput({ confidence: 61.5 }), proposalCtx())), ['V-CONF']);
});

test('문자열 JSON과 ```json 코드 블록도 읽는다', () => {
  assert.ok(checkProposal(JSON.stringify(proposalOutput()), proposalCtx()).ok);
  assert.ok(checkProposal('```json\n' + JSON.stringify(proposalOutput()) + '\n```', proposalCtx()).ok);
});

test('모델이 덧붙인 필드는 버린다', () => {
  const r = checkProposal({ ...proposalOutput(), extra: 'x' }, proposalCtx());
  assert.ok(r.ok);
  assert.equal('extra' in r.proposal, false);
});

test('V-INSTRUMENT 종목·스냅샷·시장이 작업과 다르면 오류', () => {
  assert.deepEqual(codes(checkProposal(proposalOutput({ instrumentId: 'CRYPTO:ETH' }), proposalCtx())), ['V-INSTRUMENT']);
  assert.deepEqual(codes(checkProposal(proposalOutput({ snapshotId: 'other' }), proposalCtx())), ['V-INSTRUMENT']);
});

test('P0-3-T8 현물 작업에 perpetual 제안서는 V-INSTRUMENT 스키마 오류', () => {
  const spotJob = proposalCtx('algorithm', { instrumentId: 'KR:000660', marketType: 'spot' });
  const r = checkProposal(proposalOutput({ instrumentId: 'KR:000660', marketType: 'perpetual' }), spotJob);
  assert.deepEqual(codes(r), ['V-INSTRUMENT']);
  assert.deepEqual(codes(checkProposal(proposalOutput({ marketType: 'spot' }), proposalCtx())), ['V-INSTRUMENT']);
});

test('V-ENTRY 진입 유형별 min·max 관계', () => {
  const c = (entry: { type: 'market' | 'limit' | 'zone'; min: number | null; max: number | null }) =>
    codes(checkProposal(proposalOutput({ entry }), proposalCtx()));
  assert.deepEqual(c({ type: 'market', min: null, max: null }), []);
  assert.deepEqual(c({ type: 'market', min: 100, max: null }), ['V-ENTRY']);
  assert.deepEqual(c({ type: 'limit', min: 100, max: 101 }), ['V-ENTRY']);
  assert.deepEqual(c({ type: 'limit', min: null, max: null }), ['V-ENTRY']);
  assert.deepEqual(c({ type: 'zone', min: 99, max: 101 }), []);
  assert.deepEqual(c({ type: 'zone', min: 101, max: 101 }), ['V-ENTRY']);
});

test('V-UNFORCED 강제 방향 모드에서만 필수', () => {
  const forced = proposalCtx('forced_direction');
  assert.deepEqual(codes(checkProposal(proposalOutput(), forced)), ['V-UNFORCED']);
  assert.deepEqual(codes(checkProposal(proposalOutput({ unforcedAction: 'NO_TRADE' }), forced)), []);
  assert.deepEqual(codes(checkProposal(proposalOutput({ unforcedAction: 'NO_TRADE' }), proposalCtx('scalp'))), ['V-UNFORCED']);
});

test('P0-3-T7 강제 방향 모드의 NO_TRADE 응답은 V-ACTION 스키마 오류', () => {
  const forced = proposalCtx('forced_direction');
  assert.deepEqual(
    codes(checkProposal(proposalOutput({ action: 'NO_TRADE', unforcedAction: 'NO_TRADE' }), forced)),
    ['V-ACTION'],
  );
});

test('P0-2-R3 PM MODIFY에 수정 제안이 없으면 스키마 오류, 변경 필드는 계산으로 얻는다', () => {
  const base = { reasonCodes: [], summary: 's', narrative: 'n' };
  assert.equal(checkPm({ ...base, pmDecision: 'MODIFY', modifiedFields: [], revisedProposal: null }).ok, false);
  assert.equal(checkPm({ ...base, pmDecision: 'APPROVE', modifiedFields: [], revisedProposal: proposalOutput() }).ok, false);
  assert.ok(checkPm({ ...base, pmDecision: 'MODIFY', modifiedFields: ['stopLoss'], revisedProposal: proposalOutput({ stopLoss: 99 }) }).ok);
  assert.deepEqual(diffProposalFields(proposalOutput(), proposalOutput({ stopLoss: 99 })), ['stopLoss']);
  assert.deepEqual(diffProposalFields(proposalOutput(), proposalOutput()), []);
});

test('브리핑: observation 주장은 근거 참조 필수, claimId 중복 금지', () => {
  const b = (claims: unknown[]) => ({
    claims, counterScenario: 'c', changeTriggers: [], dataLimitations: [], bias: 'NEUTRAL', summary: 's', narrative: 'n',
  });
  const ok = checkBriefing(b([{ claimId: 'c1', kind: 'observation', text: 'RSI 55', evidenceRefs: ['derived:rsi14'] }]), JOB, 'TARO');
  assert.ok(ok.ok);
  assert.equal(ok.value.briefingId, `${JOB}:TARO`);
  assert.equal(checkBriefing(b([{ claimId: 'c1', kind: 'observation', text: 'x', evidenceRefs: [] }]), JOB, 'TARO').ok, false);
  const dup = { claimId: 'c1', kind: 'interpretation', text: 'x', evidenceRefs: [] };
  assert.equal(checkBriefing(b([dup, dup]), JOB, 'TARO').ok, false);
});

test('toJsonSchema: 모든 필드 required, 추가 필드 금지, nullable은 anyOf', () => {
  const s = toJsonSchema(ProposalOutputSchema) as { required: string[]; additionalProperties: boolean; properties: Record<string, unknown> };
  assert.deepEqual(s.required, Object.keys(ProposalOutputSchema.props));
  assert.equal(s.additionalProperties, false);
  assert.deepEqual(s.properties.stopLoss, { anyOf: [{ type: 'number', description: '> 0' }, { type: 'null' }] });
  assert.equal(JSON.stringify(s).includes('pattern'), false);
});

test('DSL: 오류 코드는 가장 가까운 노드의 code를 따른다', () => {
  const s = obj({ a: str(), b: nul(int({ code: 'V-X' })) });
  assert.deepEqual(parse(s, { a: 'x', b: null }), { ok: true, value: { a: 'x', b: null } });
  const r = parse(s, { a: 1, b: 1.5 });
  assert.equal(r.ok, false);
  assert.deepEqual(!r.ok && r.errors.map((e) => [e.code, e.path]), [['V-PARSE', '$.a'], ['V-X', '$.b']]);
});
