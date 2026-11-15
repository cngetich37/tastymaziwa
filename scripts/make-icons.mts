/**
 * Draws the app icons (home screen, splash, Apple touch icon) and the
 * favicon from the logo. Run after changing the logo or brand colours:
 * `npx tsx scripts/make-icons.mts`. The outputs are committed, so the build
 * never needs this.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { BRAND, LOGO_SHAPES, LOGO_SHAPES_SMALL } from '../src/lib/brand';

const OUT = path.resolve('public/icons');
const FAVICON = path.resolve('src/app/favicon.ico');

const colour = { milk: BRAND.milk, blue: BRAND.blue, butter: BRAND.butter };
const draw = (shapes: typeof LOGO_SHAPES) =>
  shapes
    .map((s) =>
      s.stroke
        ? `<path d="${s.d}" fill="none" stroke="${colour[s.fill]}" stroke-width="1.6" stroke-linecap="round"/>`
        : `<path d="${s.d}" fill="${colour[s.fill]}"/>`,
    )
    .join('');

/**
 * `scale`: how much of the canvas the 32-unit logo grid fills. Maskable icons
 * keep the churn inside the 80% safe zone, since Android may crop to a circle.
 * Below 96px the simplified churn is used, since the details turn to mush.
 */
function svg({ size, scale, rounded }: { size: number; scale: number; rounded: boolean }) {
  const glyph = size * scale;
  const offset = (size - glyph) / 2;
  const radius = rounded ? size * 0.22 : 0;
  const churn = draw(size < 96 ? LOGO_SHAPES_SMALL : LOGO_SHAPES);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${BRAND.blue}"/>
  <g transform="translate(${offset} ${offset}) scale(${glyph / 32})">${churn}</g>
</svg>`);
}

const png = (opts: { size: number; scale: number; rounded: boolean }) =>
  sharp(svg(opts)).png({ compressionLevel: 9 }).toBuffer();

const icons = [
  { file: 'icon-192.png', size: 192, scale: 0.92, rounded: true },
  { file: 'icon-512.png', size: 512, scale: 0.92, rounded: true },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.72, rounded: false },
  { file: 'apple-touch-icon.png', size: 180, scale: 0.86, rounded: false },
];

mkdirSync(OUT, { recursive: true });
for (const icon of icons) {
  writeFileSync(path.join(OUT, icon.file), await png(icon));
  console.log(`public/icons/${icon.file}`);
}

/** favicon.ico: a header, one directory entry per size, then the PNGs. */
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((size) => png({ size, scale: 1, rounded: true })));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
  const entry = 6 + 16 * i;
  header.writeUInt8(size, entry); // width
  header.writeUInt8(size, entry + 1); // height
  header.writeUInt16LE(1, entry + 4); // colour planes
  header.writeUInt16LE(32, entry + 6); // bits per pixel
  header.writeUInt32LE(images[i].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[i].length;
});
writeFileSync(FAVICON, Buffer.concat([header, ...images]));
console.log('src/app/favicon.ico');
