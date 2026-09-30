import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bookPayload, emptyForm, fieldErrors, formToPosition, holdingLabel, positionToForm, staleWarning, summaryRows,
} from '../../src/web/position.js';
import { panelModel } from '../../src/web/model.js';

const NOW = Date.parse('2026-09-30T12:00:00Z');
const btcPerp = {
  id: '11111111-1111-4111-8111-111111111111', instrumentId: 'CRYPTO:BTC', marketType: 'perpetual', side: 'LONG',
  avgEntryPrice: 60000, quantity: 0.5, leverage: 5, marginMode: 'isolated', liquidationPrice: 50000, stopLoss: 58000,
  targets: [65000, 70000], openedAt: null, note: '메모',
};
const samsung = {
  id: '22222222-2222-4222-8222-222222222222', instrumentId: 'KR:005930', marketType: 'spot', side: 'LONG',
  avgEntryPrice: 70000, quantity: 10, leverage: null, marginMode: null, liquidationPrice: null, stopLoss: null,
  targets: [], openedAt: null, note: '',
};
function view(positions: unknown[], updatedAt = '2026-09-30T10:00:00Z', status = 'ok') {
  return {
    status, errors: [],
    book: { schemaVersion: 'positions/1', updatedAt, account: { equity: { KRW: null, USD: 10000, USDT: null }, riskPerTradePercent: 1 }, positions },
    names: { 'CRYPTO:BTC': '비트코인 (BTC)', 'KR:005930': '삼성전자' },
  };
}
const board = (instrumentId: string, value: number, currency = 'USD') => ({ instrumentId, price: { value, currency } });

test('P2-1-R1 폼 글자 → PUT 포지션: 숫자 변환, 빈칸은 null, 목표 최대 3개, 새 포지션은 symbol로 보낸다', () => {
  const f = { ...emptyForm(), symbol: ' BTC ', marketType: 'perpetual', side: 'SHORT', avgEntryPrice: '60,000.5', quantity: '0.2', leverage: '10', marginMode: 'cross', liquidationPrice: '', stopLoss: '62000', targets: '55000, 52000 50000', note: ' 단타 ' };
  assert.deepEqual(formToPosition(f, null), {
    symbol: 'BTC', marketType: 'perpetual', side: 'SHORT', avgEntryPrice: 60000.5, quantity: 0.2, leverage: 10, marginMode: 'cross',
    liquidationPrice: null, stopLoss: 62000, targets: [55000, 52000, 50000], openedAt: null, note: '단타',
  });
  // 현물은 방향·레버리지·마진·청산가를 보내지 않는다 (서버 검증과 같은 조합)
  const spot = formToPosition({ ...f, marketType: 'spot', side: 'SHORT' }, null);
  assert.equal(spot.side, 'LONG');
  assert.equal(spot.leverage, null);
  assert.equal(spot.marginMode, null);
  assert.equal(spot.liquidationPrice, null);
  // 숫자가 아니면 그대로 글자를 보내 서버가 필드 오류로 거절하게 한다
  assert.equal(formToPosition({ ...f, quantity: 'abc' }, null).quantity, 'abc');
});

test('P2-1-R1 기존 포지션 수정: 종목 글자를 안 바꾸면 id·instrumentId를 유지하고, 바꾸면 symbol로 다시 해석한다', () => {
  const form = positionToForm(btcPerp, '비트코인 (BTC)');
  assert.equal(form.symbol, '비트코인 (BTC)');
  assert.equal(form.targets, '65000, 70000');
  assert.equal(form.leverage, '5');
  const same = formToPosition(form, btcPerp);
  assert.equal(same.id, btcPerp.id);
  assert.equal(same.instrumentId, 'CRYPTO:BTC');
  assert.equal('symbol' in same, false);
  assert.equal(same.note, '메모');
  const moved = formToPosition({ ...form, symbol: 'ETH' }, btcPerp);
  assert.equal(moved.id, btcPerp.id);
  assert.equal(moved.symbol, 'ETH');
  assert.equal('instrumentId' in moved, false);
});

test('P2-1-R1 저장 본문은 북 전체 교체 (계좌 글자 → 숫자, 빈칸은 null)', () => {
  const b = view([samsung]).book;
  const body = bookPayload(b, { KRW: '', USD: '10,000', USDT: ' 500 ', risk: '0.5' }, [samsung]);
  assert.deepEqual(body.account, { equity: { KRW: null, USD: 10000, USDT: 500 }, riskPerTradePercent: 0.5 });
  assert.deepEqual(body.positions, [samsung]);
  assert.equal(body.schemaVersion, 'positions/1');
  assert.equal('updatedAt' in body, false); // 서버 시각으로 정한다
});

test('P2-1-R1 400 응답의 errors[].path → 필드별 오류 (편집 중인 포지션 번호 기준)', () => {
  const errors = [
    { path: '$.positions[1].quantity', message: '0보다 커야 함' },
    { path: '$.positions[1].symbol', message: '지원하지 않는 종목: ZZZ' },
    { path: '$.positions[0].stopLoss', message: '다른 포지션' },
    { path: '$.account.equity.USD', message: '0보다 커야 함' },
    { path: '$.account.riskPerTradePercent', message: '5 이하' },
    { path: '$.positions', message: '같은 종목·시장 중복' },
  ];
  const r = fieldErrors(errors, 1);
  assert.deepEqual(r.fields, { quantity: '0보다 커야 함', symbol: '지원하지 않는 종목: ZZZ', USD: '0보다 커야 함', risk: '5 이하' });
  assert.deepEqual(r.other, ['1번 포지션 · stopLoss: 다른 포지션', '$.positions: 같은 종목·시장 중복']);
  // instrumentId 오류는 종목 칸에 표시한다
  assert.deepEqual(fieldErrors([{ path: '$.positions[0].instrumentId', message: '등록되지 않은 종목' }], 0).fields, { symbol: '등록되지 않은 종목' });
});

test('P2-1-R7 상단 요약: 종목·방향·평단, 전광판 종목과 같으면 수익률, 마지막 갱신', () => {
  const s = summaryRows(view([btcPerp, samsung]), board('CRYPTO:BTC', 63000), NOW);
  assert.equal(s.updated, '2시간 전 갱신');
  assert.deepEqual(s.rows.map((r: { text: string }) => r.text), ['비트코인 (BTC) 무기한 롱 · 평단 $60,000.00 · +5.00%', '삼성전자 현물 롱 · 평단 ₩70,000']);
  assert.equal(s.rows[0]!.tone, 'up');
  // 숏은 평단 대비 (1 − 현재가/평단)
  const short = summaryRows(view([{ ...btcPerp, side: 'SHORT', liquidationPrice: 70000 }]), board('CRYPTO:BTC', 63000), NOW);
  assert.match(short.rows[0]!.text, /숏 · 평단 \$60,000\.00 · -5\.00%$/);
  assert.equal(short.rows[0]!.tone, 'down');
  assert.equal(summaryRows(view([]), null, NOW).rows.length, 0);
  assert.equal(summaryRows(view([]), null, NOW).empty, '보유 포지션 없음');
  assert.equal(summaryRows(view([], NOW_ISO(), 'missing'), null, NOW).updated, '입력한 적 없음');
});
const NOW_ISO = () => new Date(NOW).toISOString();

test('P2-1-R7 분석 버튼 옆 대상 종목 보유 표시 (모드별 시장, 강제 방향은 보유를 쓰지 않음)', () => {
  const v = view([btcPerp, samsung]);
  assert.equal(holdingLabel(v, board('CRYPTO:BTC', 63000), 'scalp'), '보유: 무기한 롱 · 평단 $60,000.00');
  assert.equal(holdingLabel(v, board('CRYPTO:BTC', 63000), 'algorithm'), '보유 없음 · 다른 시장 보유 있음: 무기한 롱');
  assert.equal(holdingLabel(v, board('KR:005930', 71000, 'KRW'), 'algorithm'), '보유: 현물 롱 · 평단 ₩70,000');
  assert.equal(holdingLabel(v, board('US:AAPL', 200), 'algorithm'), '보유 없음');
  assert.equal(holdingLabel(v, board('CRYPTO:BTC', 63000), 'forced_direction'), '강제 방향은 보유를 반영하지 않음');
  assert.equal(holdingLabel(null, board('CRYPTO:BTC', 63000), 'scalp'), ''); // LAN·못 읽음
  assert.equal(holdingLabel(v, null, 'scalp'), '');
  assert.equal(holdingLabel(view([btcPerp], '2026-09-30T10:00:00Z', 'invalid'), board('CRYPTO:BTC', 1), 'scalp'), '포지션 파일 오류 · 보유 없이 분석됨');
});

test('P2-1-R9 북 updatedAt이 24시간보다 오래되면 시작 화면 경고 (파일이 없으면 경고 없음)', () => {
  assert.equal(staleWarning(view([samsung], '2026-09-29T11:00:00Z'), NOW), '보유 정보가 25시간 전 기준');
  assert.equal(staleWarning(view([samsung], '2026-09-29T13:00:00Z'), NOW), null);
  assert.equal(staleWarning(view([], '2026-09-01T00:00:00Z', 'missing'), NOW), null);
  assert.equal(staleWarning(null, NOW), null);
});

test('P2-1-R9·R10 결과 패널에 작업의 positionNotes를 한 줄씩 표시한다', () => {
  const job = {
    state: 'COMPLETED', panel: { badges: [], title: 't', headline: 'h', tone: 'neutral', notes: ['n1'] },
    finalDecision: { action: 'NO_TRADE', proposal: null, confidence: null, ruleEngine: { violations: [] } },
    positionNotes: ['다른 시장 보유 있음: 비트코인 (BTC) 무기한', '보유 정보가 30시간 전 기준'],
  };
  assert.deepEqual(panelModel(job, NOW)!.positionNotes, job.positionNotes);
  assert.deepEqual(panelModel({ ...job, positionNotes: undefined }, NOW)!.positionNotes, []);
});
