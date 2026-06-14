// avatar-preview.mjs — rasterize the avatar set to a PNG for visual review.
// usage: node tools/avatar-preview.mjs
import sharp from 'sharp';
import { avatarSvg, bodySvg } from '../public/js/avatars.js';

const CELL = 64, GAP = 8, PAD = 24, COLS = 10;
const users = [1, 3, 7];
const rows = users.length + 1; // portrait rows + 1 body row
const W = PAD * 2 + COLS * CELL + (COLS - 1) * GAP;
const H = PAD * 2 + rows * (CELL + 22) + 40;

function embed(svg, x, y, size) {
  const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const vb = svg.match(/viewBox="([^"]+)"/)[1];
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="${vb}">${inner}</svg>`;
}
function label(x, y, t, color = '#7a7a90') {
  return `<text x="${x}" y="${y}" font-family="monospace" font-size="11" fill="${color}" text-anchor="middle">${t}</text>`;
}

let body = `<rect width="${W}" height="${H}" fill="#0a0a12"/>`;
body += `<text x="${PAD}" y="18" font-family="monospace" font-size="13" fill="#c8ff1f">LOCKED IN — avatar ranks (lv1 → HIM)</text>`;

let y = PAD + 8;
for (const uid of users) {
  let x = PAD;
  for (let lv = 1; lv <= 10; lv++) {
    body += embed(avatarSvg(uid, lv), x, y, CELL);
    if (uid === users[0]) body += label(x + CELL / 2, y - 4, 'lv' + lv, '#888');
    x += CELL + GAP;
  }
  body += label(PAD - 6, y + CELL / 2, '', '#666');
  y += CELL + 22;
}
// body sprites row
body += `<text x="${PAD}" y="${y + 2}" font-family="monospace" font-size="11" fill="#37e0a0">full-body evolution</text>`;
y += 14;
let x = PAD;
for (let lv = 1; lv <= 10; lv++) {
  body += embed(bodySvg(3, lv), x, y, CELL);
  x += CELL + GAP;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`;
await sharp(Buffer.from(svg)).png().toFile('data/avatar-preview.png');
console.log('wrote data/avatar-preview.png', W + 'x' + H);
