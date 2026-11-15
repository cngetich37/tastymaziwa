/**
 * Pure helpers for the Reports page: date ranges, debt ageing, margin per
 * litre and CSV export. No I/O, so they are unit-tested directly.
 */
import { addDays, daysBetween, formatLongDate, type BusinessDate } from '@/lib/dates';
import { centsToKesString } from '@/lib/money';

// --- date ranges -----------------------------------------------------------------

export const RANGE_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number]['value'];

export interface DateRange {
  from: BusinessDate;
  to: BusinessDate;
  /** The preset it came from, or 'custom'. */
  preset: RangePreset | 'custom';
  label: string;
}

/** Longest custom range, so one report can't scan years of ledger at once. */
export const MAX_RANGE_DAYS = 366;

const isRealDate = (v: unknown): v is BusinessDate =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && addDays(v, 0) === v;

const monthStart = (date: BusinessDate) => `${date.slice(0, 7)}-01`;

function presetRange(preset: RangePreset, today: BusinessDate): { from: BusinessDate; to: BusinessDate } {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case 'month':
      return { from: monthStart(today), to: today };
    case 'last-month': {
      const lastDay = addDays(monthStart(today), -1);
      return { from: monthStart(lastDay), to: lastDay };
    }
  }
}

/**
 * The `?range=` / `?from=&to=` page parameters as a date range. Custom dates
 * are clamped to today, swapped if reversed, and capped at MAX_RANGE_DAYS.
 * Anything unreadable falls back to this month.
 */
export function resolveRange(
  params: { range?: unknown; from?: unknown; to?: unknown },
  today: BusinessDate,
): DateRange {
  if (isRealDate(params.from) || isRealDate(params.to)) {
    let from = isRealDate(params.from) ? params.from : isRealDate(params.to) ? params.to : today;
    let to = isRealDate(params.to) ? params.to : today;
    if (to > today) to = today;
    if (from > today) from = today;
    if (from > to) [from, to] = [to, from];
    if (daysBetween(from, to) >= MAX_RANGE_DAYS) from = addDays(to, -(MAX_RANGE_DAYS - 1));
    return { from, to, preset: 'custom', label: rangeLabel(from, to) };
  }
  const preset = RANGE_PRESETS.find((p) => p.value === params.range) ?? RANGE_PRESETS[4];
  const { from, to } = presetRange(preset.value, today);
  return { from, to, preset: preset.value, label: `${preset.label} · ${rangeLabel(from, to)}` };
}

export const rangeLabel = (from: BusinessDate, to: BusinessDate) =>
  from === to ? formatLongDate(from) : `${formatLongDate(from)} – ${formatLongDate(to)}`;

// --- credit ageing -----------------------------------------------------------------

export const AGE_BUCKETS = ['current', 'd1_7', 'd8_30', 'd30_plus'] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];
export const AGE_BUCKET_LABELS: Record<AgeBucket, string> = {
  current: 'Not yet due',
  d1_7: '1–7 days late',
  d8_30: '8–30 days late',
  d30_plus: 'Over 30 days late',
};

export function ageBucket(daysOverdue: number): AgeBucket {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 7) return 'd1_7';
  if (daysOverdue <= 30) return 'd8_30';
  return 'd30_plus';
}

export interface AgeingRow extends Record<AgeBucket, number> {
  customerId: string;
  customerName: string;
  totalCents: number;
  oldestDate: BusinessDate;
  maxDaysOverdue: number;
}

/**
 * Unpaid credit (after payments are applied oldest-first) per customer and
 * bucket. Input is one row per unpaid sale. Most overdue customers first.
 */
export function ageingByCustomer(
  unpaid: Iterable<{
    customerId: string;
    customerName: string;
    businessDate: BusinessDate;
    outstandingCents: number;
    daysOverdue: number;
  }>,
): AgeingRow[] {
  const rows = new Map<string, AgeingRow>();
  for (const sale of unpaid) {
    if (sale.outstandingCents <= 0) continue;
    let row = rows.get(sale.customerId);
    if (!row) {
      row = {
        customerId: sale.customerId,
        customerName: sale.customerName,
        totalCents: 0,
        oldestDate: sale.businessDate,
        maxDaysOverdue: 0,
        current: 0,
        d1_7: 0,
        d8_30: 0,
        d30_plus: 0,
      };
      rows.set(sale.customerId, row);
    }
    row[ageBucket(sale.daysOverdue)] += sale.outstandingCents;
    row.totalCents += sale.outstandingCents;
    if (sale.businessDate < row.oldestDate) row.oldestDate = sale.businessDate;
    row.maxDaysOverdue = Math.max(row.maxDaysOverdue, sale.daysOverdue);
  }
  return [...rows.values()].sort(
    (a, b) => b.maxDaysOverdue - a.maxDaysOverdue || b.totalCents - a.totalCents || a.customerName.localeCompare(b.customerName),
  );
}

// --- margins ---------------------------------------------------------------------

/** Average price per litre in cents, rounded to the nearest cent; null with no litres. */
export function perLitreCents(totalCents: number, volumeMl: number): number | null {
  if (volumeMl === 0) return null;
  return Math.round((totalCents * 1000) / volumeMl);
}

/**
 * What the shop keeps on each litre: average selling price minus average
 * buying price. Null until both milk was bought and sold in the period.
 */
export function marginPerLitreCents(s: {
  salesCents: number;
  salesMl: number;
  deliveryCostCents: number;
  deliveredMl: number;
}): number | null {
  const sell = perLitreCents(s.salesCents, s.salesMl);
  const buy = perLitreCents(s.deliveryCostCents, s.deliveredMl);
  return sell == null || buy == null ? null : sell - buy;
}

// --- tables and CSV ----------------------------------------------------------------

export type ColumnType = 'text' | 'date' | 'kes' | 'litres' | 'int';
export type Cell = string | number | null;

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
}

export interface ReportTable {
  title: string;
  description?: string;
  columns: ReportColumn[];
  rows: Record<string, Cell>[];
  /** A totals row, keyed like the columns. */
  totals?: Record<string, Cell>;
  emptyText?: string;
}

/** A cell as it goes into a spreadsheet: plain numbers (KES, litres), no symbols. */
export function csvValue(value: Cell, type: ColumnType): string {
  if (value == null) return '';
  if (typeof value === 'number') {
    if (type === 'kes') return centsToKesString(value);
    if (type === 'litres') return String(value / 1000);
  }
  return String(value);
}

const csvEscape = (s: string) =>
  // Quote anything with a delimiter, quote or newline; neutralise formula injection.
  /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)
    ? `"'${s.replace(/"/g, '""')}"`
    : /[",\r\n]/.test(s)
      ? `"${s.replace(/"/g, '""')}"`
      : s;

const headerLabel = (c: ReportColumn) =>
  c.type === 'kes' ? `${c.label} (KES)` : c.type === 'litres' ? `${c.label} (L)` : c.label;

export function toCsv(table: ReportTable): string {
  const lines = [table.columns.map((c) => csvEscape(headerLabel(c))).join(',')];
  for (const row of [...table.rows, ...(table.totals ? [table.totals] : [])]) {
    lines.push(table.columns.map((c) => csvEscape(csvValue(row[c.key] ?? null, c.type))).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
