// @ts-check
// 픽셀 캐릭터. 외부 이미지 없이(CSP) 글자 지도로 그린 뒤 캔버스를 CSS로 키운다 (image-rendering: pixelated).

/** 사람 캐릭터 (12×14). h 머리, s 피부, e 눈, m 입, b 옷, c 옷깃, k 책상, l 노트북, g 화면 */
const PERSON = [
  '...hhhhhh...',
  '..hhhhhhhh..',
  '..hssssssh..',
  '..sseesses..',
  '..ssssssss..',
  '...ssmmss...',
  '....ssss....',
  '..bbbccbbb..',
  '.bbbbccbbbb.',
  '.bbbbbbbbbb.',
  '.ss.bbbb.ss.',
  'kkkkkllkkkkk',
  'kkkkkggkkkkk',
  '.k........k.',
];

/** 황소 (BULL) */
const BULL = [
  'w..........w',
  'ww.hhhhhh.ww',
  '.whhhhhhhhw.',
  '..hhhhhhhh..',
  '..heehheeh..',
  '..hhhhhhhh..',
  '...hnnnnh...',
  '...hnmmnh...',
  '..bbbbbbbb..',
  '.bbbbbbbbbb.',
  '.hhbbbbbbhh.',
  'kkkkkllkkkkk',
  'kkkkkggkkkkk',
  '.k........k.',
];

/** 곰 (BEAR) */
const BEAR = [
  '.hh......hh.',
  '.hhhhhhhhhh.',
  '..hhhhhhhh..',
  '..heehheeh..',
  '..hhhhhhhh..',
  '...hnnnnh...',
  '...hnmmnh...',
  '....hhhh....',
  '..bbbbbbbb..',
  '.bbbbbbbbbb.',
  '.hhbbbbbbhh.',
  'kkkkkllkkkkk',
  'kkkkkggkkkkk',
  '.k........k.',
];

/** @type {Record<string, { map: string[]; h: string; s?: string; b: string; c?: string }>} */
const LOOK = {
  TARO: { map: PERSON, h: '#2f6fd6', b: '#2f9e5a' },
  DIANA: { map: PERSON, h: '#7a3b2e', b: '#c2456b' },
  NOVA: { map: PERSON, h: '#f2c94c', b: '#2aa198' },
  VIBE: { map: PERSON, h: '#8e5bd6', b: '#6c4bb4' },
  BULL: { map: BULL, h: '#e08a2c', b: '#b8661c' },
  BEAR: { map: BEAR, h: '#c0392b', b: '#8e2a20' },
  RISKY: { map: PERSON, h: '#e8561f', b: '#d9822b' },
  NEUTRAL: { map: PERSON, h: '#8a94a6', b: '#56627a' },
  SAFE: { map: PERSON, h: '#2bb5a0', b: '#1f7f72' },
  BLITZ: { map: PERSON, h: '#f5d33c', b: '#d4462a' },
  GUARD: { map: PERSON, h: '#3b4a5c', b: '#2c6e49' },
  ACE: { map: PERSON, h: '#f0d27a', b: '#1d1d1d', c: '#e0b43c' },
  PM: { map: PERSON, h: '#222222', b: '#2b2b35', c: '#f2f2f2' },
};

/**
 * @param {string} role
 * @param {number} [frame] 0 또는 1 (생각 중일 때 화면 깜빡임)
 * @returns {HTMLCanvasElement}
 */
export function drawCharacter(role, frame = 0) {
  const look = LOOK[role] ?? LOOK.NEUTRAL;
  if (!look) throw new Error(role);
  const map = look.map;
  const canvas = document.createElement('canvas');
  canvas.width = map[0]?.length ?? 12;
  canvas.height = map.length;
  paint(canvas, look, frame);
  return canvas;
}

/** @param {HTMLCanvasElement} canvas @param {string} role @param {number} frame */
export function repaint(canvas, role, frame) {
  const look = LOOK[role] ?? LOOK.NEUTRAL;
  if (look) paint(canvas, look, frame);
}

/** @param {HTMLCanvasElement} canvas @param {{ map: string[]; h: string; s?: string; b: string; c?: string }} look @param {number} frame */
function paint(canvas, look, frame) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  /** @type {Record<string, string>} */
  const pal = {
    h: look.h, s: look.s ?? '#f1c9a5', e: '#1b1b1b', m: '#a0453a', b: look.b, c: look.c ?? look.b,
    w: '#f4f1e8', n: '#f3b28e', k: '#8a5a33', l: '#3a3f4b', g: frame ? '#9cff9c' : '#35c46a',
  };
  look.map.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = pal[row[x] ?? '.'];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  });
}
