/**
 * Encryption for M-Pesa credentials at rest (AES-256-GCM), and HMACs for the
 * per-request callback secrets.
 *
 * Key: MPESA_CREDENTIALS_KEY (32 bytes, base64) if set; otherwise derived from
 * AUTH_SECRET with HKDF. Rotating the key means owners re-enter credentials.
 */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

function key(): Buffer {
  const explicit = process.env.MPESA_CREDENTIALS_KEY;
  if (explicit) {
    const k = Buffer.from(explicit, 'base64');
    if (k.length !== 32) throw new Error('MPESA_CREDENTIALS_KEY must be 32 bytes, base64-encoded');
    return k;
  }
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not set');
  return Buffer.from(hkdfSync('sha256', secret, 'tastymaziwa', 'mpesa-credentials-v1', 32));
}

/** "v1.<iv>.<tag>.<ciphertext>", all base64url. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
}

export function decryptSecret(sealed: string): string {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('Unreadable M-Pesa credential');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

/** A fresh secret for one request's callback URL; only its HMAC is stored. */
export const newCallbackToken = () => randomBytes(24).toString('base64url');

export function hashCallbackToken(token: string): string {
  return createHmac('sha256', key()).update(`mpesa-callback:${token}`).digest('base64url');
}

export function callbackTokenMatches(token: string, storedHash: string): boolean {
  const a = Buffer.from(hashCallbackToken(token));
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}
