/** Auth timings and URLs, overridable via env for tests. */

const seconds = (name: string, fallback: number) => {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

export const authConfig = {
  /** Idle timeout: the session cookie slides forward on every request. */
  get sessionIdleSeconds() {
    return seconds('SESSION_IDLE_SECONDS', 30 * 60);
  },
  /** Hard limit from sign-in, however active the user is (one shift). */
  get sessionMaxSeconds() {
    return seconds('SESSION_MAX_SECONDS', 12 * 60 * 60);
  },
  /** How often a live session re-checks the user is still active/unchanged. */
  get sessionRecheckSeconds() {
    return seconds('SESSION_RECHECK_SECONDS', 5 * 60);
  },
  codeTtlSeconds: 10 * 60,
  signupCodeTtlSeconds: 15 * 60,
  resetTtlSeconds: 30 * 60,
  inviteTtlSeconds: 72 * 60 * 60,
  maxCodeAttempts: 5,
};

/**
 * Base URL for links in emails. Never derived from the request's Host header
 * (that would allow password-reset poisoning): APP_URL, else Vercel's own
 * URLs, else localhost.
 */
export function appUrl(): string {
  const explicit = process.env.APP_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  if (process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 9002}`;
}
