/**
 * Business-day helpers. The shop runs on Nairobi time (UTC+3, no DST); "today"
 * always means the Nairobi calendar day, regardless of the server's timezone.
 */

export const BUSINESS_TZ = 'Africa/Nairobi';

/** ISO calendar date, e.g. "2026-11-08". */
export type BusinessDate = string;

const isoDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The Nairobi calendar date that `instant` falls on. */
export function toBusinessDate(instant: Date): BusinessDate {
  return isoDateFormatter.format(instant);
}

export function todayBusinessDate(now: Date = new Date()): BusinessDate {
  return toBusinessDate(now);
}

/** Add whole days to a business date (pure calendar arithmetic, UTC-based). */
export function addDays(date: BusinessDate, days: number): BusinessDate {
  const [y, m, d] = date.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return utc.toISOString().slice(0, 10);
}

/** The `n` business dates ending at (and including) `end`, oldest first. */
export function lastNDates(n: number, end: BusinessDate): BusinessDate[] {
  return Array.from({ length: n }, (_, i) => addDays(end, i - (n - 1)));
}

/** Whole days from `from` to `to` (positive if `to` is later). */
export function daysBetween(from: BusinessDate, to: BusinessDate): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

const shortFormatter = new Intl.DateTimeFormat('en-KE', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
});
const longFormatter = new Intl.DateTimeFormat('en-KE', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const timeFormatter = new Intl.DateTimeFormat('en-KE', {
  timeZone: BUSINESS_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const asUtcMidnight = (date: BusinessDate) => new Date(`${date}T00:00:00Z`);

/** "2026-11-08" → "8 Nov" */
export const formatShortDate = (date: BusinessDate) => shortFormatter.format(asUtcMidnight(date));
/** "2026-11-08" → "8 Nov 2026" */
export const formatLongDate = (date: BusinessDate) => longFormatter.format(asUtcMidnight(date));
/** Instant → "14:05" in Nairobi time */
export const formatTime = (instant: Date) => timeFormatter.format(instant);
