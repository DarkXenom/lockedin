// badges.js — rank insignia. a pixel shield per level, tier metals,
// one glyph per title in the org chart. HIM glows. obviously.

// tier frame colors by level
function tierColor(lv) {
  if (lv >= 10) return '#ffd23f';        // HIM — gold (plus glow)
  if (lv >= 9) return '#c8ff1f';         // volt
  if (lv >= 7) return '#ffd23f';         // gold
  if (lv >= 5) return '#cfd6e4';         // silver
  if (lv >= 3) return '#c47a3d';         // bronze
  return '#6a6a7e';                      // gray
}

// 8x8 glyphs, one per level — bureaucratic mythology
const GLYPHS = {
  1: [ // gravity arrow — unpaid intern of gravity
    '...aa...',
    '...aa...',
    '...aa...',
    '.aaaaaa.',
    '..aaaa..',
    '...aa...',
  ],
  2: [ // suitcase — tourist, gym district
    '..aaaa..',
    'aaaaaaaa',
    'aaaaaaaa',
    'aaa..aaa',
    'aaaaaaaa',
    'aaaaaaaa',
  ],
  3: [ // the bench — junior bench associate
    '........',
    'aaaaaaaa',
    'aaaaaaaa',
    '..a..a..',
    '..a..a..',
    '..a..a..',
  ],
  4: [ // membership card — card-carrying regular
    'aaaaaaaa',
    'a..aaaaa',
    'a..a...a',
    'aaaaaaaa',
    'a.aa.aaa',
    'aaaaaaaa',
  ],
  5: [ // padlock — certified locked in
    '..aaaa..',
    '.aa..aa.',
    '.aa..aa.',
    'aaaaaaaa',
    'aaa..aaa',
    'aaaaaaaa',
  ],
  6: [ // hazard — licensed local menace
    '...aa...',
    '..adda..',
    '..adda..',
    '.aaddaa.',
    '.aaaaaa.',
    'aaaddaaa',
  ],
  7: [ // case file — registered public problem
    '.aaaaaa.',
    '.a....a.',
    '.aaaaaa.',
    '.a....a.',
    '.aaaaaa.',
    '.aaaaaa.',
  ],
  8: [ // ascending load — director of overload
    '......aa',
    '......aa',
    '....aaaa',
    '....aaaa',
    '..aaaaaa',
    'aaaaaaaa',
  ],
  9: [ // the beam — load-bearing member
    'aaaaaaaa',
    '...aa...',
    '...aa...',
    '...aa...',
    '...aa...',
    'aaaaaaaa',
  ],
  10: [ // the crown — HIM
    'a..aa..a',
    'aa.aa.aa',
    'aaaaaaaa',
    'aaaaaaaa',
    '.aaaaaa.',
    '.aaaaaa.',
  ],
};

// 16x16 pixel shield frame
const SHIELD = [
  '..ffffffffffff..',
  '.fxxxxxxxxxxxxf.',
  '.fxxxxxxxxxxxxf.',
  '.fxxxxxxxxxxxxf.',
  '.fxxxxxxxxxxxxf.',
  '.fxxxxxxxxxxxxf.',
  '.fxxxxxxxxxxxxf.',
  '.fxxxxxxxxxxxxf.',
  '.fxxxxxxxxxxxxf.',
  '.fxxxxxxxxxxxxf.',
  '.fxxxxxxxxxxxxf.',
  '..fxxxxxxxxxxf..',
  '...fxxxxxxxxf...',
  '....fxxxxxxf....',
  '.....fxxxxf.....',
  '......ffff......',
];

export function badgeSvg(lv, { size = 'full' } = {}) {
  const frame = tierColor(lv);
  const glyph = GLYPHS[lv] || GLYPHS[1];
  let out = '';
  // shield
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const ch = SHIELD[y][x];
      if (ch === 'f') out += `<rect x="${x}" y="${y}" width="1" height="1" fill="${frame}"/>`;
      else if (ch === 'x') out += `<rect x="${x}" y="${y}" width="1" height="1" fill="#14111c"/>`;
    }
  }
  // glyph centered (8 wide, start x=4; vertically centered around row 5-11)
  const gy = Math.floor((16 - glyph.length) / 2);
  for (let y = 0; y < glyph.length; y++) {
    for (let x = 0; x < 8; x++) {
      const ch = glyph[y][x];
      if (ch === 'a') out += `<rect x="${x + 4}" y="${y + gy}" width="1" height="1" fill="${frame}"/>`;
      else if (ch === 'd') out += `<rect x="${x + 4}" y="${y + gy}" width="1" height="1" fill="#14111c"/>`;
    }
  }
  const glow = lv >= 10
    ? `style="filter:drop-shadow(0 0 4px rgba(200,255,31,0.7))"`
    : lv >= 9 ? `style="filter:drop-shadow(0 0 3px rgba(200,255,31,0.45))"` : '';
  return `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" ${glow}>${out}</svg>`;
}
