/**
 * Draws the app icons (home screen, splash, Apple touch icon) from the logo.
 * Run after changing the logo or brand colour: `npx tsx scripts/make-icons.mts`.
 * The PNGs in public/icons are committed, so the build never needs this.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

/** --primary in light mode: hsl(161 84% 26%). */
const BRAND = '#0b7a58';
const OUT = path.resolve('public/icons');

/** The Logo component's paths, in white on the brand colour. */
const bottle = `
  <path d="M8 2h8v2.1l-2.2 2.2c-1.2.9-2.8.9-4 0L8 4.1V2z" />
  <path d="M5 7.5v11.5c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V7.5c0-1.2-1.3-2-2.5-1.5L12 8.5 7.5 6c-1.2-.5-2.5.3-2.5 1.5z" />
  <path d="M12 8.5v12.5" />`;

/**
 * `scale`: how much of the canvas the bottle fills. Maskable icons keep it
 * inside the 80% safe zone, since Android may crop them to a circle.
 */
function svg({ size, scale, rounded }: { size: number; scale: number; rounded: boolean }) {
  const glyph = size * scale;
  const offset = (size - glyph) / 2;
  const radius = rounded ? size * 0.22 : 0;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${BRAND}"/>
  <g transform="translate(${offset} ${offset}) scale(${glyph / 24})" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${bottle}</g>
</svg>`);
}

const icons = [
  { file: 'icon-192.png', size: 192, scale: 0.62, rounded: true },
  { file: 'icon-512.png', size: 512, scale: 0.62, rounded: true },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.5, rounded: false },
  { file: 'apple-touch-icon.png', size: 180, scale: 0.6, rounded: false },
];

mkdirSync(OUT, { recursive: true });
for (const icon of icons) {
  await sharp(svg(icon)).png({ compressionLevel: 9 }).toFile(path.join(OUT, icon.file));
  console.log(`public/icons/${icon.file}`);
}
