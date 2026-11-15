import Link from 'next/link';
import { CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';
import { DataTable, type Column } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { PostPayrollButton } from '@/components/people-panels';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { monthRange, shiftMonth } from '@/lib/calc/finance';
import { formatLongDate, todayBusinessDate } from '@/lib/dates';
import { formatKES } from '@/lib/money';
import { OWNER } from '@/lib/roles';
import { payrollPreview, type PayrollPreviewLine } from '@/server/ledger';
import { listPayrollRuns } from '@/server/queries';
import { requireUser } from '@/server/session';

export const metadata = { title: 'Payroll · TastyMaziwa' };

const monthName = (m: string) =>
  new Intl.DateTimeFormat('en-KE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));

interface Line {
  key: string;
  name: string;
  basis: string;
  grossCents: number;
  advancesCents: number;
  netCents: number;
}

const columns: Column<Line>[] = [
  { key: 'name', header: 'Name', primary: true, cell: (l) => l.name },
  { key: 'basis', header: 'Worked', cell: (l) => l.basis },
  { key: 'gross', header: 'Earned', align: 'right', cell: (l) => formatKES(l.grossCents) },
  { key: 'advances', header: 'Less advances', align: 'right', cell: (l) => (l.advancesCents ? `−${formatKES(l.advancesCents)}` : '—') },
  { key: 'net', header: 'To pay', align: 'right', cell: (l) => <strong>{formatKES(l.netCents)}</strong> },
];

const basis = (l: PayrollPreviewLine) =>
  l.payType === 'daily'
    ? `${l.daysWorked} day${l.daysWorked === 1 ? '' : 's'} × ${formatKES(l.rateCents)}`
    : `Monthly ${formatKES(l.rateCents)}`;

/** Wages for a month: preview what each person is owed, then pay it once. */
export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await requireUser(OWNER);
  const today = todayBusinessDate();
  const { month } = monthRange((await searchParams).month, today);
  const db = await getDb();
  const [preview, runs] = await Promise.all([payrollPreview(db, user.shopId, month), listPayrollRuns(db, user.shopId)]);
  const paid = runs.find((r) => r.month === month);
  const isCurrent = month === today.slice(0, 7);

  const previewLines: Line[] = preview
    .filter((l) => l.grossCents > 0 || l.advancesCents > 0)
    .map((l) => ({ key: l.employeeId, name: l.name, basis: basis(l), grossCents: l.grossCents, advancesCents: l.advancesCents, netCents: l.netCents }));
  const paidLines: Line[] =
    paid?.lines.map((l, i) => ({
      key: `${i}`,
      name: l.name,
      basis: `${l.daysWorked} day${l.daysWorked === 1 ? '' : 's'}`,
      grossCents: l.grossCents,
      advancesCents: l.advancesCents,
      netCents: l.netCents,
    })) ?? [];
  const lines = paid ? paidLines : previewLines;
  const total = (k: 'grossCents' | 'advancesCents' | 'netCents') => lines.reduce((n, l) => n + l[k], 0);

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Payroll"
        description={`Wages for ${monthName(month)}`}
        actions={
          !paid && total('netCents') + total('advancesCents') > 0 ? (
            <PostPayrollButton month={month} monthLabel={monthName(month)} netCents={total('netCents')} />
          ) : undefined
        }
      />

      <nav aria-label="Choose a month" className="flex items-center gap-2">
        <Button asChild variant="outline" size="icon" className="size-11">
          <Link href={`/payroll?month=${shiftMonth(month, -1)}`} aria-label="Previous month">
            <ChevronLeft className="size-5" aria-hidden />
          </Link>
        </Button>
        <span className="min-w-36 text-center font-medium">{monthName(month)}</span>
        {isCurrent ? (
          <Button variant="outline" size="icon" className="size-11" disabled aria-label="Next month">
            <ChevronRight className="size-5" aria-hidden />
          </Button>
        ) : (
          <Button asChild variant="outline" size="icon" className="size-11">
            <Link href={`/payroll?month=${shiftMonth(month, 1)}`} aria-label="Next month">
              <ChevronRight className="size-5" aria-hidden />
            </Link>
          </Button>
        )}
      </nav>

      {paid && (
        <p role="status" className="flex items-center gap-2 rounded-lg border border-green-600/30 bg-green-600/5 px-4 py-3 text-sm">
          <CheckCircle2 className="size-5 shrink-0 text-green-700 dark:text-green-400" aria-hidden />
          Paid {formatKES(paid.netCents)} by {paid.paymentMethod === 'mpesa' ? 'M-Pesa' : 'cash'} on{' '}
          {formatLongDate(paid.postedAt.toISOString().slice(0, 10))}
          {paid.postedByName ? ` by ${paid.postedByName}` : ''}.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{paid ? 'Paid' : isCurrent ? 'So far this month' : 'To pay'}</CardTitle>
          <CardDescription>
            Day workers: days marked present × day rate. Monthly staff: salary, prorated in their first month. Advances
            are taken off.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            label="Payroll"
            columns={columns}
            rows={lines}
            rowKey={(l) => l.key}
            empty="Nobody is due pay for this month. Add staff and mark attendance under Staff."
            footer={{
              name: 'Total',
              gross: formatKES(total('grossCents')),
              advances: total('advancesCents') ? `−${formatKES(total('advancesCents'))}` : '—',
              net: <strong>{formatKES(total('netCents'))}</strong>,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
