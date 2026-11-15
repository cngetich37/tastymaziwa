/**
 * Draws the app icons (home screen, splash, Apple touch icon) from the logo.
 * Run after changing the logo or brand colours: `npx tsx scripts/make-icons.mts`.
 * The PNGs in public/icons are committed, so the build never needs this.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { BRAND, LOGO_SHAPES } from '../src/lib/brand';

const OUT = path.resolve('public/icons');

const colour = { milk: BRAND.milk, blue: BRAND.blue, butter: BRAND.butter };
const churn = LOGO_SHAPES.map((s) =>
  s.stroke
    ? `<path d="${s.d}" fill="none" stroke="${colour[s.fill]}" stroke-width="1.6" stroke-linecap="round"/>`
    : `<path d="${s.d}" fill="${colour[s.fill]}"/>`,
).join('');

/**
 * `scale`: how much of the canvas the 32-unit logo grid fills. Maskable icons
 * keep the churn inside the 80% safe zone, since Android may crop to a circle.
 */
function svg({ size, scale, rounded }: { size: number; scale: number; rounded: boolean }) {
  const glyph = size * scale;
  const offset = (size - glyph) / 2;
  const radius = rounded ? size * 0.22 : 0;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${BRAND.blue}"/>
  <g transform="translate(${offset} ${offset}) scale(${glyph / 32})">${churn}</g>
</svg>`);
}

const icons = [
  { file: 'icon-192.png', size: 192, scale: 0.92, rounded: true },
  { file: 'icon-512.png', size: 512, scale: 0.92, rounded: true },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.72, rounded: false },
  { file: 'apple-touch-icon.png', size: 180, scale: 0.86, rounded: false },
];

mkdirSync(OUT, { recursive: true });
for (const icon of icons) {
  await sharp(svg(icon)).png({ compressionLevel: 9 }).toFile(path.join(OUT, icon.file));
  console.log(`public/icons/${icon.file}`);
}
