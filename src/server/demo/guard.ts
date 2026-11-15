/**
 * Demo sandboxes ("Try the demo") must never reach the outside world: no
 * emails to typed-in addresses, no M-Pesa prompts to real phones, no
 * WhatsApp messages. Services that do any of that call `isDemoShop` first.
 *
 * Kept free of other server imports so ledger.ts and accounts.ts can use it
 * without an import cycle.
 */
import { eq } from 'drizzle-orm';
import type { DB, Tx } from '@/db/client';
import { shops } from '@/db/schema';

/** Demo logins get addresses here (RFC 2606 `.invalid`), so mail can never be delivered. */
export const DEMO_EMAIL_DOMAIN = 'demo.tastymaziwa.invalid';

export const isDemoEmail = (email: string) => email.toLowerCase().endsWith('.invalid');

export async function isDemoShop(q: DB | Tx, shopId: string): Promise<boolean> {
  const [row] = await q.select({ demoExpiresAt: shops.demoExpiresAt }).from(shops).where(eq(shops.id, shopId));
  return row?.demoExpiresAt != null;
}

/** The DomainError message for a feature that is off in the demo. */
export const demoOff = (what: string) =>
  `${what} is switched off in the demo shop. Create your own shop to use it.`;

/** Whole hours until a demo shop is purged (at least 1, for the banner). */
export const demoHoursLeft = (expiresAt: Date, now = Date.now()) =>
  Math.max(1, Math.round((expiresAt.getTime() - now) / 3_600_000));
