// avatars.js — layered pixel portrait engine. colorful at every rank.
// each member has a stable identity (skin, hair, signature accent) from their id.
// the COSTUME escalates with rank: gym tee -> tank -> hoodie -> track jacket ->
// leather lifting vest -> bronze -> iron -> steel+cape -> gold -> HIM (crown+aura).
// no grayscale. ever. the lowest rank still has color — it just isn't armored.

// ---------------- identity ----------------
const SKINS = [
  ['#ffd9bd', '#e9b596'], ['#f0c2a0', '#d79c6c'], ['#d29a6e', '#b27a4e'],
  ['#a9744a', '#8a5734'], ['#7a4a2c', '#5e3720'],
];
const HAIR_COLORS = ['#2a2630', '#43301f', '#6b431f', '#9a5f2a', '#caa14a', '#e6e0d4', '#4a5168', '#7d3548', '#b5483a'];
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

// rank tier (1..10) -> visual stage (0..5) used by the full-body sprite
export function stageForLevel(lv) {
  if (lv >= 10) return 5;
  if (lv >= 8) return 4;
  if (lv >= 6) return 3;
  if (lv >= 4) return 2;
  if (lv >= 2) return 1;
  return 0;
}

// ---------------- base portrait (16x16 bust) ----------------
const HEAD = [
  '................',
  '................',
  '.....ssssss.....',
  '....ssssssss....',
  '....ssssssss....',
  '....ssssssss....',
  '....ssssssss....',
  '....ssssssss....',
  '.....ssssss.....',
  '......ssss......',
  '......ssSs......',
  '................',
  '................',
  '................',
  '................',
  '................',
];
const FACE = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '......w..w......',
  '......e..e......',
  '................',
  '.......mm.......',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
];

// hair styles (member identity). drawn over the head; high-rank helmets sit on top.
const HAIRS = [
  [ // 0 buzz
    '................',
    '....hhhhhhhh....',
    '...hhhhhhhhhh...',
    '...hH......Hh...',
  ],
  [ // 1 curly crown
    '....hhhhhhhh....',
    '..hhhhhhhhhhhh..',
    '..hhhHHHHHHhhh..',
    '..hh......hh....',
  ],
  [ // 2 spikes
    '...h.hh.hh.h....',
    '...hhhhhhhhhh...',
    '...hhhhhhhhhh...',
    '...hH......Hh...',
  ],
  [ // 3 side sweep
    '....hhhhhhhh....',
    '...hhhhhhhhhh...',
    '...hhhhhhh.hh...',
    '...hh...........',
  ],
  [ // 4 curtains
    '....hhh..hhh....',
    '...hhhh..hhhh...',
    '...hhh....hhh...',
    '...hH......Hh...',
  ],
  [ // 5 top bun
    '.......hh.......',
    '....hhhhhhhh....',
    '...hhhhhhhhhh...',
    '...hH......Hh...',
  ],
  [ // 6 fade + line
    '................',
    '....hhhhhhhh....',
    '...hhhhhhhhhh...',
    '....hhhhhhhh....',
  ],
];

// ---------------- costumes per rank (rows ~10-15, shoulders/chest) ----------------
// tokens: 1 primary  2 trim  3 dark/metal  s skin(arms)  x cape  o outline
const COSTUMES = {
  tee: [
    '................','................','................','................','................','................',
    '................','................','................','................',
    '.......11.......',
    '.....11111111...',
    '...1111111111...',
    '..111111111111..',
    '.11111111111111.',
    '11111111111111111',
  ],
  tank: [
    '................','................','................','................','................','................',
    '................','................','................','................',
    '......1..1......',
    '.s...1111...s...',
    '.ss.111111..ss..',
    '.ss1111111111ss.',
    '.s111111111111s.',
    '.1111111111111s.',
  ],
  hoodie: [
    '................','................','................','................','................','................',
    '................','................','................',
    '.....2....2.....',
    '....21....12....',
    '...2111111112...',
    '..211111111112..',
    '.21111111111112.',
    '.11111111111111.',
    '11111111111111111',
  ],
  jacket: [
    '................','................','................','................','................','................',
    '................','................','................','................',
    '......2..2......',
    '....1112111.....',
    '...111121111....',
    '..11112211111...',
    '.1111122111111.',
    '111111221111111',
  ],
  vest: [ // leather lifting vest + belt, sleeveless (skin arms)
    '................','................','................','................','................','................',
    '................','................','................','................',
    '......ss........',
    '.s..511115..s...',
    '.ss.211112.ss...',
    '.s..211112..s...',
    '.s..555555..s...',
    '....211112......',
  ],
  bronze: [ // clean bronze pauldrons + chestplate
    '................','................','................','................','................','................',
    '................','................','................','................',
    '......5555......',
    '.111.555555.111.',
    '.122.522225.221.',
    '.123.211112.321.',
    '.123.211112.321.',
    '.133.222222.331.',
  ],
  iron: [ // iron plate, same clean shape
    '................','................','................','................','................','................',
    '................','................','................','................',
    '......5555......',
    '.111.555555.111.',
    '.122.522225.221.',
    '.123.211112.321.',
    '.123.211112.321.',
    '.133.222222.331.',
  ],
  steel: [ // steel armor + cape (x) behind
    '................','................','................','................','................','................',
    '................','................','................','................',
    '......5555......',
    'x111.555555.111x',
    'x122.522225.221x',
    'x123.211112.321x',
    'x123.211112.321x',
    'xx33.222222.33xx',
  ],
  gold: [ // dark armor with gold trim + cape
    '................','................','................','................','................','................',
    '................','................','................','................',
    '......5555......',
    'x115.555555.511x',
    'x125.522225.521x',
    'x123.255552.321x',
    'x123.211112.321x',
    'xx35.222222.53xx',
  ],
  him: [ // radiant gold full plate + cape, brightest
    '................','................','................','................','................','................',
    '................','................','................','................',
    '......5555......',
    'x511.555555.115x',
    'x152.522225.251x',
    'x125.255552.521x',
    'x125.211112.521x',
    'xx55.222222.55xx',
  ],
};

// ---------------- headgear per rank (rows 0-3, over hair) ----------------
const CAPS = {
  none: [],
  band: [
    '................',
    '................',
    '...4444444444...',
    '...4444444444...',
  ],
  hood: [
    '..2..........2..',
    '..2hhhhhhhhhh2..',
    '..21........12..',
    '..2..........2..',
  ],
  cap: [
    '....44444444....',
    '...4444444444...',
    '...44444444455..',
    '................',
  ],
  rim: [ // metal brow guard
    '................',
    '................',
    '...5555555555...',
    '...3333333333...',
  ],
  circlet: [ // thin banded circlet with side points
    '................',
    '...5......5.....',
    '...5555555555...',
    '....33333333....',
  ],
  circletgem: [ // circlet with a center gem
    '.......6........',
    '...5...6...5....',
    '...5555555555...',
    '....33333333....',
  ],
  crown: [ // three-point crown with gems
    '...6..6..6......',
    '...5555555555...',
    '...5666666665...',
    '...5555555555...',
  ],
};

// lv1..10 -> costume keyword + cap keyword + palette resolver
const RANKS = [
  { costume: 'tee',    cap: 'none',       cols: a => ({ 1: a, 2: shade(a), 3: shade(shade(a)) }) },
  { costume: 'tank',   cap: 'band',       cols: a => ({ 1: a, 2: '#f4f2ee', 3: shade(a), 4: a }) },
  { costume: 'hoodie', cap: 'hood',       cols: a => ({ 1: a, 2: shade(a), 3: shade(shade(a)) }) },
  { costume: 'jacket', cap: 'cap',        cols: a => ({ 1: a, 2: '#f4f2ee', 3: shade(a), 4: a, 5: shade(a) }) },
  { costume: 'vest',   cap: 'band',       cols: a => ({ 1: '#6e4423', 2: '#b9892f', 3: '#4a2c14', 4: a }) },
  { costume: 'bronze', cap: 'rim',        cols: a => ({ 1: '#e6b463', 2: '#c1813c', 3: '#8a5a26', 5: '#e6b463' }) },
  { costume: 'iron',   cap: 'rim',        cols: a => ({ 1: '#cdd4e0', 2: '#959db1', 3: '#5f6678', 5: '#aeb6c6' }) },
  { costume: 'steel',  cap: 'circlet',    cols: a => ({ 1: '#c2cad8', 2: '#7b8398', 3: '#3a3f4d', 5: '#aeb6c6', 6: a, x: a }) },
  { costume: 'gold',   cap: 'circletgem', cols: a => ({ 1: '#3a3550', 2: '#4a4564', 3: '#2a2740', 5: '#e6c052', 6: a, x: a }) },
  { costume: 'him',    cap: 'crown',      cols: a => ({ 1: '#ffe27a', 2: '#e0a92e', 3: '#b9842a', 5: '#fff1a6', 6: '#fff', x: '#c8ff1f' }) },
];

function paint(grid, matrix, map) {
  for (let y = 0; y < matrix.length; y++) {
    const row = matrix[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ' || !(ch in map)) continue;
      grid[y][x] = map[ch];
    }
  }
}
function rects(grid, rows, cols) {
  let out = '';
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++)
      if (grid[y][x]) out += `<rect x="${x}" y="${y}" width="1" height="1" fill="${grid[y][x]}"/>`;
  return out;
}

export function avatarSvg(userId, level, opts = {}) {
  const id = identity(userId);
  const lv = Math.max(1, Math.min(10, level || 1));
  const rank = RANKS[lv - 1];
  const accent = id.accent;
  const helmetCoversHair = lv >= 8; // royalty (circlet/crown) covers hair; warriors keep it
  const cmap = rank.cols(accent);

  const map = {
    s: id.skin[0], S: id.skin[1],
    h: id.hairColor, H: shade(id.hairColor),
    w: '#f6f4ef', e: '#1c1822', m: id.skin[1],
    1: cmap[1], 2: cmap[2], 3: cmap[3],
    4: cmap[4] || accent, 5: cmap[5] || '#cfd6e4', 6: cmap[6] || '#fff',
    x: cmap.x || accent, o: '#14121a',
  };

  const grid = Array.from({ length: 16 }, () => Array(16).fill(null));
  paint(grid, HEAD, map);
  paint(grid, FACE, map);
  if (!helmetCoversHair) paint(grid, HAIRS[id.hairStyle], map);
  else { // show just a sliver of hair under the helmet
    const trimmed = HAIRS[id.hairStyle].slice(2);
    paint(grid, ['................', '................', ...trimmed], map);
  }
  paint(grid, COSTUMES[rank.costume], map);
  if (rank.cap !== 'none') paint(grid, CAPS[rank.cap], map);

  const bg = backdrop(accent, lv);
  let extra = '';
  if (lv === 10) {
    extra = `<rect x="0.5" y="0.5" width="15" height="15" rx="3.5" fill="none" stroke="#ffe27a" stroke-width="0.8" opacity="0.95"/>
      <rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="none" stroke="#c8ff1f" stroke-width="0.4" opacity="0.6"/>`;
  } else if (lv === 9) {
    extra = `<rect x="0.5" y="0.5" width="15" height="15" rx="3.5" fill="none" stroke="#e6c052" stroke-width="0.6" opacity="0.7"/>`;
  } else if (lv >= 8) {
    extra = `<rect x="0.5" y="0.5" width="15" height="15" rx="3.5" fill="none" stroke="${accent}" stroke-width="0.5" opacity="0.55"/>`;
  }
  // colorful by default; opts.grayscale is the deliberate "skipped today" cue, not the old launch-grey.
  const style = opts.grayscale ? ' style="filter:saturate(0.15) brightness(0.7)"' : '';
  return `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"${style}>
    <rect width="16" height="16" rx="3.5" fill="${bg}"/>${rects(grid, 16, 16)}${extra}</svg>`;
}

// ---------------- color utils ----------------
function backdrop(hex, lv) {
  const [r, g, b] = hexRgb(hex);
  const lift = lv >= 8 ? 26 : 16;
  const k = lv >= 8 ? 0.22 : 0.16;
  return rgbHex(Math.round(r * k + lift * 0.6), Math.round(g * k + lift * 0.6), Math.round(b * k + lift));
}
function shade(hex) {
  const [r, g, b] = hexRgb(hex);
  return rgbHex(Math.round(r * 0.6), Math.round(g * 0.6), Math.round(b * 0.6));
}
function hexRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function rgbHex(r, g, b) {
  const c = v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

// ---------------- full-body evolution sprites (12x16) ----------------
// colorful escalation matching the rank armor. shown in the profile evolution strip.
// tokens: h hair s skin 1 costume 2 trim 3 dark/metal p legs o shoe x cape g glow
const BODIES = [
  [ // stage0 lv1 — gym tee
    '....hhhh....','...hssssh...','...ssssss...','...sesses...','...ssssss...',
    '....ssss....','....1111....','...111111...','..s111111s..','...111111...',
    '....1111....','....pppp....','....p..p....','....p..p....','....o..o....','............',
  ],
  [ // stage1 lv2-3 — tank/hoodie, headband
    '...a4444a...','...hssssh...','...ssssss...','...sesses...','...ssssss...',
    '....ssss....','...111111...','..s1111 1s..','..s111111s..','...111111...',
    '...111111...','...pppppp...','...pp..pp...','...pp..pp...','...oo..oo...','............',
  ],
  [ // stage2 lv4-5 — jacket/vest, cap
    '...444444...','..4hssssh4..','...ssssss...','...sesses...','...ssssss...',
    '...ssssss...','..21111112..','.s211111 2s.','.s211111 2s.','..211111 2..',
    '..1122 11...','..pppppp....','..pp..pp....','..pp..pp....','..oo..oo....','............',
  ],
  [ // stage3 lv6-7 — bronze/iron pauldrons
    '...5555555..','..5hssssh5..','...ssssss...','...sesses...','...ssssss...',
    '..3ssssss3..','.331111133..','3321111123 3','3211111112 3','.211111112..',
    '..1133 11...','..pppppp....','..pp..pp....','..pp..pp....','..oo..oo....','............',
  ],
  [ // stage4 lv8-9 — steel/gold armor + cape
    '...555555...','..5hssssh5..','..xssssssx..','..xsessesx..','..xssssssx..',
    '.x3ssssss3x.','.x33222233x.','xx3211123 xx','x 321111 23x','. 21111112..',
    '..132233 1..','..pppppp....','..pp..pp....','..pp..pp....','..oo..oo....','............',
  ],
  [ // stage5 lv10 — HIM radiant + crown
    '.g5.5.5.5g..','..5hssssh5..','.gxssssssxg.','..xsessesx..','..xssssssx..',
    '.x32ssss23x.','gx33555533xg','xx3253352 3x','x 325335 23x','. g2553352..',
    '..1325533 1.','..pppppp....','..ppp.ppp...','..pp...pp...','..oo...oo...','...g....g...',
  ],
];

export function bodySvg(userId, level, opts = {}) {
  const id = identity(userId);
  const lv = Math.max(1, Math.min(10, level || 1));
  const stage = stageForLevel(lv);
  const rank = RANKS[lv - 1];
  const accent = id.accent;
  const cmap = rank.cols(accent);
  const map = {
    h: id.hairColor, s: id.skin[0], S: id.skin[1], e: '#1c1822',
    1: cmap[1], 2: cmap[2] || shade(cmap[1]), 3: cmap[3] || shade(shade(cmap[1])),
    4: cmap[4] || accent, 5: cmap[5] || '#cfd6e4', 6: cmap[6] || '#fff',
    p: '#33304a', o: '#22202c', x: cmap.x || accent, a: accent, g: '#c8ff1f',
  };
  const m = BODIES[stage];
  const grid = Array.from({ length: m.length }, () => Array(13).fill(null));
  paint(grid, m, map);
  const style = opts.grayscale ? ' style="filter:saturate(0.2) brightness(0.7)"' : '';
  return `<svg viewBox="0 0 13 16" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"${style}>${rects(grid, m.length, 13)}</svg>`;
}
