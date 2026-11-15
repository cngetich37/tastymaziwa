/**
 * Till/paybill reconciliation: who paid, and which recorded sale a payment
 * belongs to. Pure and unit-tested; hashing is done by the caller.
 */

/** What Safaricom sends as the payer's number. */
export type Payer =
  | { kind: 'phone'; phone: string }
  | { kind: 'hash'; hash: string }
  | { kind: 'masked'; prefix: string; suffix: string }
  | { kind: 'unknown' };

/**
 * The MSISDN field, in any of its forms: plain (sandbox), masked
 * ("2547****678") or, on live shortcodes, a SHA-256 hex digest.
 */
export function readMsisdn(raw: string | null | undefined): Payer {
  const s = (raw ?? '').trim();
  if (/^254[17]\d{8}$/.test(s)) return { kind: 'phone', phone: `+${s}` };
  if (/^[0-9a-f]{64}$/i.test(s)) return { kind: 'hash', hash: s.toLowerCase() };
  const masked = /^(\d{3,6})[*xX]+(\d{2,4})$/.exec(s.replace(/\s/g, ''));
  if (masked) return { kind: 'masked', prefix: masked[1], suffix: masked[2] };
  return { kind: 'unknown' };
}

/** +254712345678 → 254712345678: what Safaricom hashes. */
export const msisdnDigits = (e164: string) => e164.replace(/^\+/, '');

export interface CustomerPhone {
  id: string;
  /** E.164 */
  phone: string;
  /** SHA-256 hex of msisdnDigits(phone). */
  phoneHash: string;
}

/** Customers the payer's number could belong to (a masked number may fit several). */
export function payerMatches(payer: Payer, customers: CustomerPhone[]): string[] {
  switch (payer.kind) {
    case 'phone':
      return customers.filter((c) => c.phone === payer.phone).map((c) => c.id);
    case 'hash':
      return customers.filter((c) => c.phoneHash === payer.hash).map((c) => c.id);
    case 'masked':
      return customers
        .filter((c) => {
          const d = msisdnDigits(c.phone);
          return d.startsWith(payer.prefix) && d.endsWith(payer.suffix);
        })
        .map((c) => c.id);
    case 'unknown':
      return [];
  }
}

/** A paybill account number that is a customer's phone ("0712 345 678", "254712…"). */
export function accountMatches(billRef: string | null | undefined, customers: CustomerPhone[]): string[] {
  const digits = (billRef ?? '').replace(/\D/g, '');
  const m = /^(?:254|0)?([17]\d{8})$/.exec(digits);
  if (!m) return [];
  const phone = `+254${m[1]}`;
  return customers.filter((c) => c.phone === phone).map((c) => c.id);
}

/** How far apart a payment and a hand-recorded sale may be to count as the same. */
export const MATCH_WINDOW_MINUTES = 15;

/**
 * The hand-recorded M-Pesa sale a payment confirms: same amount, recorded
 * within the window, closest in time. Null if none fits.
 */
export function closestSale<T extends { id: string; amountCents: number; at: Date }>(
  amountCents: number,
  at: Date,
  sales: T[],
  windowMinutes = MATCH_WINDOW_MINUTES,
): T | null {
  let best: T | null = null;
  let bestGap = Infinity;
  for (const s of sales) {
    if (s.amountCents !== amountCents) continue;
    const gap = Math.abs(s.at.getTime() - at.getTime());
    if (gap <= windowMinutes * 60_000 && gap < bestGap) {
      best = s;
      bestGap = gap;
    }
  }
  return best;
}

/** Daraja's TransTime ("20261115101500", Nairobi time) as an instant. */
export function parseTransTime(raw: string | number | null | undefined, fallback = new Date()): Date {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(raw ?? ''));
  if (!m) return fallback;
  const [, y, mo, d, h, mi, s] = m;
  const at = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+03:00`);
  return Number.isNaN(at.getTime()) ? fallback : at;
}

/** Shillings as Safaricom sends them ("1.00", 150) → cents, or null. */
export function amountToCents(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}
