import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { RangePicker, chipClass } from '@/components/range-picker';
import { DownloadCsvButton, PrintButton } from '@/components/report-actions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { resolveRange, type Cell, type ColumnType, type ReportTable } from '@/lib/calc/reports';
import { formatLongDate, formatShortDate, todayBusinessDate } from '@/lib/dates';
import { formatKES, formatLitres } from '@/lib/money';
import { OWNER } from '@/lib/roles';
import { cn } from '@/lib/utils';
import { REPORT_TYPES, type ReportType } from '@/lib/validation';
import { REPORT_INFO, getReport, type ReportStat } from '@/server/reports';
import { getShop } from '@/server/queries';
import { requireUser } from '@/server/session';

export const metadata = { title: 'Reports · TastyMaziwa' };

type Search = { type?: string; range?: string; from?: string; to?: string };

function format(value: Cell, type: ColumnType): string {
  if (value == null) return '—';
  if (typeof value === 'string') return type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatShortDate(value) : value;
  if (type === 'kes') return formatKES(value);
  if (type === 'litres') return formatLitres(value);
  return value.toLocaleString('en-KE');
}

const isNumeric = (type: ColumnType) => type === 'kes' || type === 'litres' || type === 'int';

function Stat({ stat }: { stat: ReportStat }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-sm text-muted-foreground">{stat.label}</p>
      <p
        className={cn(
          'mt-1 truncate text-xl font-bold tabular-nums',
          stat.tone === 'positive' && 'text-green-700 dark:text-green-400',
          stat.tone === 'negative' && 'text-red-600 dark:text-red-400',
          stat.tone === 'warning' && 'text-amber-600 dark:text-amber-400',
          stat.type === 'kes' && (stat.value ?? 0) < 0 && 'text-red-600 dark:text-red-400',
        )}
      >
        {format(stat.value, stat.type)}
      </p>
    </div>
  );
}

function TableCard({ table, filename }: { table: ReportTable; filename: string }) {
  const rows = table.totals ? [...table.rows, table.totals] : table.rows;
  return (
    <Card className="break-inside-avoid">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>{table.title}</CardTitle>
          {table.description && <CardDescription>{table.description}</CardDescription>}
        </div>
        <DownloadCsvButton table={table} filename={filename} />
      </CardHeader>
      <CardContent>
        {table.rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{table.emptyText ?? 'Nothing to show.'}</p>
        ) : (
          // Wide tables scroll inside the card on a phone, never the whole page.
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  {table.columns.map((c) => (
                    <th key={c.key} scope="col" className={cn('px-2 py-2 font-medium first:pl-0', isNumeric(c.type) && 'text-right')}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const isTotal = table.totals != null && i === rows.length - 1;
                  return (
                    <tr key={i} className={cn('border-b last:border-0', isTotal && 'border-t-2 font-semibold')}>
                      {table.columns.map((c) => {
                        const v = row[c.key] ?? null;
                        return (
                          <td
                            key={c.key}
                            className={cn(
                              'px-2 py-2 first:pl-0',
                              isNumeric(c.type) && 'text-right tabular-nums',
                              c.type === 'kes' && typeof v === 'number' && v < 0 && 'text-red-600 dark:text-red-400',
                              c.key === 'status' && v === 'rejected' && 'text-red-600 dark:text-red-400',
                              c.key === 'status' && v === 'pending' && 'text-amber-600 dark:text-amber-400',
                            )}
                          >
                            {format(v, c.type)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The owner's reports: pick a report and a period, read it here, download
 * any table as CSV, or print / save it as PDF. Plain links and a GET form,
 * so it works without JavaScript and on a slow connection.
 */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(OWNER);
  const sp = await searchParams;
  const type: ReportType = REPORT_TYPES.includes(sp.type as ReportType) ? (sp.type as ReportType) : 'profit';
  const today = todayBusinessDate();
  const range = resolveRange(sp, today);
  const db = await getDb();
  const [report, shop] = await Promise.all([getReport(db, user.shopId, type, range), getShop(db, user.shopId)]);

  const href = (params: Search) => {
    const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])));
    return `/reports?${q}`;
  };
  // Keep the chosen period when switching report, and the report when switching period.
  const periodParams: Search =
    range.preset === 'custom' ? { from: range.from, to: range.to } : { range: range.preset };
  const period = report.usesRange ? range.label : `As of ${formatLongDate(today)}`;
  const fileBase = `${type}-${report.usesRange ? `${range.from}_${range.to}` : today}`;

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Reports"
        description={
          <>
            <span className="hidden print:inline">{shop?.name} · </span>
            {report.title} · {period}
          </>
        }
        actions={<PrintButton />}
      />

      <nav aria-label="Choose a report" className="print:hidden">
        <ul className="flex flex-wrap gap-2">
          {REPORT_TYPES.map((t) => (
            <li key={t}>
              <Link href={href({ type: t, ...periodParams })} aria-current={t === type ? 'page' : undefined} className={chipClass(t === type)}>
                {REPORT_INFO[t].title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {report.usesRange && <RangePicker basePath="/reports" range={range} today={today} keep={{ type }} />}

      <p className="-mb-2 text-sm text-muted-foreground">{report.description}</p>

      {report.stats.length > 0 && (
        <section aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {report.stats.map((s) => (
            <Stat key={s.label} stat={s} />
          ))}
        </section>
      )}

      {report.tables.map((t, i) => (
        <TableCard key={t.title} table={t} filename={`${fileBase}${i ? `-${i + 1}` : ''}.csv`} />
      ))}
    </div>
  );
}
