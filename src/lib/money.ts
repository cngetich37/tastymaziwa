/**
 * Money and volume helpers. All money is integer cents (KES × 100) and all
 * volume is integer millilitres. Never do arithmetic on floats elsewhere.
 */

const DECIMAL_RE = /^\s*(-)?(\d+)(?:\.(\d*))?\s*$/;

/** Parse a decimal string ("70", "70.5", "1250.75") into an integer scaled by 10^places. */
function parseScaled(input: string | number, places: number): number {
  const text = typeof input === 'number' ? String(input) : input;
  const match = DECIMAL_RE.exec(text);
  if (!match) throw new RangeError(`Not a valid number: "${text}"`);
  const [, sign, whole, frac = ''] = match;
  if (frac.length > places) {
    throw new RangeError(`Too many decimal places in "${text}" (max ${places})`);
  }
  const scaled = Number(whole) * 10 ** places + Number(frac.padEnd(places, '0') || '0');
  if (!Number.isSafeInteger(scaled)) throw new RangeError(`Number too large: "${text}"`);
  return sign ? -scaled : scaled;
}

/** "70.50" → 7050 */
export const kesToCents = (input: string | number): number => parseScaled(input, 2);

/** "2.5" → 2500 */
export const litresToMl = (input: string | number): number => parseScaled(input, 3);

/** 7050 → "70.50" (plain decimal string, for form inputs) */
export function centsToKesString(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Value of `volumeMl` at `pricePerLitreCents`, rounded half away from zero to
 * the nearest cent. Integer-only: (ml × cents/L) / 1000.
 */
export function lineTotalCents(volumeMl: number, pricePerLitreCents: number): number {
  const product = volumeMl * pricePerLitreCents;
  if (!Number.isSafeInteger(product)) throw new RangeError('Line total overflow');
  const sign = product < 0 ? -1 : 1;
  const abs = Math.abs(product);
  return sign * (Math.trunc(abs / 1000) + (abs % 1000 >= 500 ? 1 : 0));
}

const kesFormatter = new Intl.NumberFormat('en-KE', {
  style: 'currency',
  currency: 'KES',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** 125000 → "Ksh 1,250" (shows cents only when present) */
export function formatKES(cents: number): string {
  return kesFormatter.format(cents / 100);
}

/** Signed variant for ledgers: "+Ksh 1,250" / "−Ksh 300" */
export function formatKESSigned(cents: number): string {
  if (cents === 0) return formatKES(0);
  return `${cents > 0 ? '+' : '−'}${formatKES(Math.abs(cents))}`;
}

const litreFormatter = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 3 });

/** 2500 → "2.5 L" */
export function formatLitres(ml: number): string {
  return `${litreFormatter.format(ml / 1000)} L`;
}
