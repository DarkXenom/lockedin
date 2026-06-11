// make-icons.mjs — rasterize icon.svg into PWA/iOS PNGs. run once: node tools/make-icons.mjs
import sharp from 'sharp';
import fs from 'node:fs';

const svg = fs.readFileSync('public/icon.svg');
fs.mkdirSync('public/icons', { recursive: true });

const jobs = [
  { file: 'public/icons/icon-192.png', size: 192, pad: 0 },
  { file: 'public/icons/icon-512.png', size: 512, pad: 0 },
  { file: 'public/icons/maskable-512.png', size: 512, pad: 64 },   // safe-zone padding for maskable
  { file: 'public/icons/apple-touch-icon.png', size: 180, pad: 0 },
];

for (const j of jobs) {
  const inner = j.size - j.pad * 2;
  const img = await sharp(svg).resize(inner, inner).png().toBuffer();
  await sharp({ create: { width: j.size, height: j.size, channels: 4, background: '#08080c' } })
    .composite([{ input: img, top: j.pad, left: j.pad }])
    .png().toFile(j.file);
  console.log('made', j.file);
}
