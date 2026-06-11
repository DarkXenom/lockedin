// avatars.js — layered pixel portrait engine.
// every member gets a stable identity (skin, hair, signature color) from their id;
// rank tier adds gear: nothing → headband → cap → visor → chain → crown.
// npc (lv1) is grayscale. that's the joke. evolution restores the color.

// ---------------- identity palettes ----------------
const SKINS = [
  ['#ffd9bd', '#eebb98'], ['#efb98d', '#d79c6c'], ['#cf9166', '#b5774d'],
  ['#a96b43', '#8d5532'], ['#7d4b2c', '#65391f'],
];
const HAIR_COLORS = ['#23202b', '#3c2a1e', '#5b3a20', '#8a5a2b', '#c98a3d', '#d9d2c7', '#52586e', '#7d3548'];
const ACCENTS = ['#8b5cf6', '#4dd7ff', '#ffb020', '#ff5c7a', '#37e0a0', '#ff7ad9', '#5c8aff', '#ff8a3d', '#c8ff1f', '#2dd4bf'];

function identity(userId) {
  const h = (userId * 2654435761) >>> 0;
  return {
    skin: SKINS[(h >>> 3) % SKINS.length],
    hairStyle: (h >>> 7) % HAIRS.length,
    hairColor: HAIR_COLORS[(h >>> 11) % HAIR_COLORS.length],
    accent: ACCENTS[userId % ACCENTS.length],
  };
}

export function stageForLevel(lv) {
  if (lv >= 10) return 5;
  if (lv >= 8) return 4;
  if (lv >= 6) return 3;
  if (lv >= 4) return 2;
  if (lv >= 2) return 1;
  return 0;
}

// ---------------- 16x16 portrait layers ----------------
const HEAD = [
  '................',
  '................',
  '....ssssssss....',
  '...ssssssssss...',
  '...ssssssssss...',
  '...ssssssssss...',
  '...ssssssssss...',
  '...ssssssssss...',
  '...ssssssssss...',
  '....ssssssss....',
  '....SssssssS....',
  '......ssss......',
  '......ssss......',
  '...cccssssccc...',
  '..ccccCssCcccc..',
  '.cccccccccccccc.',
];
const FACE = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '....bbb..bbb....',
  '....we....we....',
  '................',
  '................',
  '.......mm.......',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
];
const HAIRS = [
  // 0 buzz
  [
    '................',
    '....hhhhhhhh....',
    '...hhhhhhhhhh...',
    '...hh......hh...',
  ],
  // 1 curly crown
  [
    '....hhhhhhhh....',
    '..hhhhhhhhhhhh..',
    '..hhhhhhhhhhhh..',
    '..hhhhhhhhhhhh..',
    '..hh........hh..',
  ],
  // 2 spikes
  [
    '...h..h..h..h...',
    '...hhhhhhhhhh...',
    '...hhhhhhhhhh...',
    '...hh......hh...',
  ],
  // 3 side sweep
  [
    '................',
    '....hhhhhhhh....',
    '...hhhhhhhhhh...',
    '...hhhhhh..hh...',
    '...hh...........',
  ],
  // 4 curtains
  [
    '................',
    '....hhh..hhh....',
    '...hhhh..hhhh...',
    '...hhh....hhh...',
    '...hh......hh...',
  ],
  // 5 top bun
  [
    '.......hh.......',
    '....hhhhhhhh....',
    '...hhhhhhhhhh...',
    '...hh......hh...',
  ],
];
const GEAR = {
  // stage 1 — headband (accent)
  1: [
    '................',
    '................',
    '................',
    '................',
    '...aaaaaaaaaa...',
  ],
  // stage 2 — cap with back brim
  2: [
    '....aaaaaaaa....',
    '...aaaaaaaaaa...',
    '...aaaaaaaaAA...',
  ],
  // stage 3 — visor with glint
  3: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '...kkgkkkkkkk...',
  ],
  // stage 4 — gold chain
  4: [
    '................', '................', '................', '................',
    '................', '................', '................', '................',
    '................', '................', '................', '................',
    '................',
    '...G........G...',
    '....GG....GG....',
    '.......GG.......',
  ],
  // stage 5 — the crown (chain included; HIM wears both)
  5: [
    '...G.G.GG.G.G...',
    '...GGGGGGGGGG...',
  ],
};

function paint(grid, matrix, map) {
  for (let y = 0; y < matrix.length; y++) {
    const row = matrix[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || !(ch in map)) continue;
      grid[y][x] = map[ch];
    }
  }
}
function rects(grid, size) {
  let out = '';
  for (let y = 0; y < size; y++)
    for (let x = 0; x < grid[y].length; x++)
      if (grid[y][x]) out += `<rect x="${x}" y="${y}" width="1" height="1" fill="${grid[y][x]}"/>`;
  return out;
}

export function avatarSvg(userId, level, { grayscale = false } = {}) {
  const id = identity(userId);
  const stage = stageForLevel(level);
  const npc = stage === 0;
  const skin = npc ? ['#9a9aaa', '#83839a'] : id.skin;
  const hairC = npc ? '#5a5a6e' : id.hairColor;
  const accent = npc ? '#6a6a7e' : id.accent;
  const gearC = npc ? '#7a7a8e' : accentAlt(accent);
  const map = {
    s: skin[0], S: skin[1],
    h: hairC,
    b: hairC, w: '#f4f2ee', e: '#1b1822', m: skin[1],
    c: accent, C: shade(accent),
    a: gearC, A: shade(gearC),
    k: '#16131d', g: '#c8ff1f',
    G: '#ffd23f',
  };

  const grid = Array.from({ length: 16 }, () => Array(16).fill(null));
  paint(grid, HEAD, map);
  paint(grid, FACE, map);
  paint(grid, HAIRS[id.hairStyle], map);
  if (stage >= 1 && stage <= 4) paint(grid, GEAR[stage], map);
  if (stage === 5) { paint(grid, GEAR[4], map); paint(grid, GEAR[5], map); }

  const bg = npc ? '#191923' : backdrop(accent);
  const aura = stage === 5
    ? `<rect x="0.5" y="0.5" width="15" height="15" rx="3" fill="none" stroke="#c8ff1f" stroke-width="0.7" opacity="0.9"/>`
    : stage === 4
      ? `<rect x="0.5" y="0.5" width="15" height="15" rx="3" fill="none" stroke="#ffd23f" stroke-width="0.5" opacity="0.5"/>`
      : '';
  const style = grayscale ? 'style="filter:grayscale(1) opacity(0.55)"' : '';
  return `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" ${style}>
    <rect width="16" height="16" rx="3" fill="${bg}"/>${rects(grid, 16)}${aura}</svg>`;
}

// soft dark backdrop tinted with the member's accent
function backdrop(hex) {
  const [r, g, b] = hexRgb(hex);
  return rgbHex(Math.round(r * 0.18 + 14), Math.round(g * 0.18 + 14), Math.round(b * 0.18 + 22));
}
function shade(hex) {
  const [r, g, b] = hexRgb(hex);
  return rgbHex(Math.round(r * 0.62), Math.round(g * 0.62), Math.round(b * 0.62));
}
function accentAlt(hex) { // rotated companion color for gear so it pops against the shirt
  const [r, g, b] = hexRgb(hex);
  return rgbHex(b, r, g);
}
function hexRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function rgbHex(r, g, b) {
  const c = v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

// ---------------- full-body evolution sprites (12x14) ----------------
// the body grows with the rank. de-evolution is visible. that's the point.
const BODIES = [
  [ // 0 npc
    '....hhhh....', '...hssssh...', '...ssssss...', '...s.ss.s...', '...ssssss...',
    '....ssss....', '.....cc.....', '....cccc....', '....cccc....', '....cccc....',
    '....pppp....', '....p..p....', '....p..p....', '....o..o....',
  ],
  [ // 1
    '....hhhh....', '...hssssh...', '...ssssss...', '...s.ss.s...', '...ssssss...',
    '....ssss....', '...cccccc...', '..s.cccc.s..', '..s.cccc.s..', '....cccc....',
    '....pppp....', '....p..p....', '....p..p....', '....o..o....',
  ],
  [ // 2
    '....hhhh....', '...hssssh...', '...ssssss...', '...s.ss.s...', '...ssssss...',
    '....ssss....', '..cccccccc..', '.ss.cccc.ss.', '.ss.cccc.ss.', '....cccc....',
    '...pppppp...', '...pp..pp...', '...pp..pp...', '...oo..oo...',
  ],
  [ // 3
    '....hhhh....', '...hssssh...', '...ssssss...', '...s.ss.s...', '...ssssss...',
    '....ssss....', '.cccccccccc.', 'sss.cccc.sss', 'ss..cccc..ss', '....cccc....',
    '...pppppp...', '...pp..pp...', '...pp..pp...', '...oo..oo...',
  ],
  [ // 4
    '....hhhh....', '...hssssh...', '...ssssss...', '...s.ss.s...', '...ssssss...',
    '..ssssssss..', 'cccccccccccc', 'sss.cccc.sss', 'sss.cccc.sss', 'ss..cccc..ss',
    '...pppppp...', '...pp..pp...', '...pp..pp...', '...oo..oo...',
  ],
  [ // 5 HIM
    '.g..hhhh..g.', '...hssssh...', '...ssssss...', '...s.ss.s...', '...ssssss...',
    '.gssssssssg.', 'cccccccccccc', 'sssccccccsss', 'sssccccccsss', 'ss..cccc..ss',
    '..pppppppp..', '..ppp..ppp..', '...pp..pp...', '...oo..oo...',
  ],
];

export function bodySvg(userId, level, { grayscale = false } = {}) {
  const id = identity(userId);
  const stage = stageForLevel(level);
  const npc = stage === 0;
  const skin = npc ? ['#9a9aaa', '#83839a'] : id.skin;
  const map = {
    h: npc ? '#5a5a6e' : id.hairColor,
    s: skin[0], S: skin[1],
    c: npc ? '#6a6a7e' : id.accent,
    p: npc ? '#55556a' : '#3a3a52',
    o: '#22222e',
    g: '#c8ff1f',
  };
  const m = BODIES[stage];
  const grid = Array.from({ length: m.length }, () => Array(12).fill(null));
  paint(grid, m, map);
  const style = grayscale ? 'style="filter:grayscale(1) opacity(0.55)"' : '';
  return `<svg viewBox="0 0 12 14" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" ${style}>${rects(grid, m.length)}</svg>`;
}
