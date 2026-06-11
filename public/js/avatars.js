// avatars.js — pixel avatar evolution. wojak-free, hand-drawn matrices.
// chars: . transparent | h hair | s skin | b shirt | p shorts | o shoe/dark | g glow
// stage index 0..5 mapped from level 1..10

const STAGES = [
  // 0 — npc. gray. barely a guy. (lv 1)
  [
    '....hhhh....',
    '...hssssh...',
    '...ssssss...',
    '...s.ss.s...',
    '...ssssss...',
    '....ssss....',
    '.....bb.....',
    '....bbbb....',
    '....bbbb....',
    '....bbbb....',
    '....pppp....',
    '....p..p....',
    '....p..p....',
    '....o..o....',
  ],
  // 1 — gym tourist / benchwarmer. has arms now. (lv 2-3)
  [
    '....hhhh....',
    '...hssssh...',
    '...ssssss...',
    '...s.ss.s...',
    '...ssssss...',
    '....ssss....',
    '...bbbbbb...',
    '..s.bbbb.s..',
    '..s.bbbb.s..',
    '....bbbb....',
    '....pppp....',
    '....p..p....',
    '....p..p....',
    '....o..o....',
  ],
  // 2 — regular / locked in. shoulders appear. (lv 4-5)
  [
    '....hhhh....',
    '...hssssh...',
    '...ssssss...',
    '...s.ss.s...',
    '...ssssss...',
    '....ssss....',
    '..bbbbbbbb..',
    '.ss.bbbb.ss.',
    '.ss.bbbb.ss.',
    '....bbbb....',
    '...pppppp...',
    '...pp..pp...',
    '...pp..pp...',
    '...oo..oo...',
  ],
  // 3 — menace / problem. v-taper detected. (lv 6-7)
  [
    '....hhhh....',
    '...hssssh...',
    '...ssssss...',
    '...s.ss.s...',
    '...ssssss...',
    '....ssss....',
    '.bbbbbbbbbb.',
    'sss.bbbb.sss',
    'ss..bbbb..ss',
    '....bbbb....',
    '...pppppp...',
    '...pp..pp...',
    '...pp..pp...',
    '...oo..oo...',
  ],
  // 4 — gymmaxxed / the carry. traps own real estate. (lv 8-9)
  [
    '....hhhh....',
    '...hssssh...',
    '...ssssss...',
    '...s.ss.s...',
    '...ssssss...',
    '..ssssssss..',
    'bbbbbbbbbbbb',
    'sss.bbbb.sss',
    'sss.bbbb.sss',
    'ss..bbbb..ss',
    '...pppppp...',
    '...pp..pp...',
    '...pp..pp...',
    '...oo..oo...',
  ],
  // 5 — HIM. glowing. final form. (lv 10)
  [
    '.g..hhhh..g.',
    '...hssssh...',
    '...ssssss...',
    '...s.ss.s...',
    '...ssssss...',
    '.gssssssssg.',
    'bbbbbbbbbbbb',
    'sssbbbbbbsss',
    'sssbbbbbbsss',
    'ss..bbbb..ss',
    '..pppppppp..',
    '..ppp..ppp..',
    '...pp..pp...',
    '...oo..oo...',
  ],
];

// shirt palette rotated per user id — squad members look distinct
const SHIRTS = ['#8b5cf6', '#4dd7ff', '#ffb020', '#ff3b5c', '#c8ff1f', '#ff7ad9', '#37e0a0', '#ff8a3d'];

export function stageForLevel(lv) {
  if (lv >= 10) return 5;
  if (lv >= 8) return 4;
  if (lv >= 6) return 3;
  if (lv >= 4) return 2;
  if (lv >= 2) return 1;
  return 0;
}

export function avatarSvg(userId, level, { grayscale = false } = {}) {
  const stage = stageForLevel(level);
  const m = STAGES[stage];
  const npc = stage === 0;
  const colors = {
    h: npc ? '#4a4a5a' : '#2c2236',
    s: npc ? '#9a9aaa' : '#e0b08a',
    b: npc ? '#6a6a7a' : SHIRTS[userId % SHIRTS.length],
    p: npc ? '#55556a' : '#3a3a52',
    o: '#22222e',
    g: '#c8ff1f',
  };
  let rects = '';
  for (let y = 0; y < m.length; y++) {
    for (let x = 0; x < m[y].length; x++) {
      const c = m[y][x];
      if (c === '.') continue;
      rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${colors[c]}"/>`;
    }
  }
  const glow = stage === 5 ? `<rect x="0" y="0" width="12" height="14" fill="none" style="filter:drop-shadow(0 0 2px #c8ff1f)"/>` : '';
  const style = grayscale ? 'style="filter:grayscale(1) opacity(0.6)"' : '';
  return `<svg viewBox="0 0 12 14" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" ${style}>${rects}${glow}</svg>`;
}
