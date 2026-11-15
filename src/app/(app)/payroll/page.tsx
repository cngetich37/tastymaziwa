import Link from 'next/link';
import { CheckCircle2, ChevronLeft, ChevronRight, FileText, Landmark } from 'lucide-react';
import { DataTable, type Column } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { PostPayrollButton, RemitStatutoryButton } from '@/components/people-panels';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { monthRange, shiftMonth } from '@/lib/calc/finance';
import { formatLongDate, todayBusinessDate, toBusinessDate } from '@/lib/dates';
import { formatKES } from '@/lib/money';
import { OWNER } from '@/lib/roles';
import { payrollPreview } from '@/server/ledger';
import { getPayslips, listPayrollRuns } from '@/server/queries';
import { requireUser } from '@/server/session';

export const metadata = { title: 'Payroll · TastyMaziwa' };

const monthName = (m: string) =>
  new Intl.DateTimeFormat('en-KE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));

interface Line {
  key: string;
  name: string;
  basis: string;
  grossCents: number;
  nssfCents: number;
  shifCents: number;
  housingLevyCents: number;
  payeCents: number;
  advancesCents: number;
  netCents: number;
  employerNssfCents: number;
  employerHousingLevyCents: number;
}

const deductions = (l: Line) => l.nssfCents + l.shifCents + l.housingLevyCents + l.payeCents;
const minus = (cents: number) => (cents ? `−${formatKES(cents)}` : '—');

const columns: Column<Line>[] = [
  { key: 'name', header: 'Name', primary: true, cell: (l) => l.name },
  { key: 'basis', header: 'Worked', cell: (l) => l.basis },
  { key: 'gross', header: 'Earned', align: 'right', cell: (l) => formatKES(l.grossCents) },
  {
    key: 'statutory',
    header: 'NSSF, SHIF, levy, PAYE',
    align: 'right',
    cell: (l) => minus(deductions(l)),
  },
  { key: 'advances', header: 'Advances', align: 'right', cell: (l) => minus(l.advancesCents) },
  { key: 'net', header: 'To pay', align: 'right', cell: (l) => <strong>{formatKES(l.netCents)}</strong> },
];

/** The 9th of the month after `month`: when PAYE, NSSF, SHIF and the levy are due. */
const dueDate = (month: string) => `${shiftMonth(month, 1)}-09`;

/** Wages for a month: preview what each person is owed, pay it once, then pay the deductions over. */
export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await requireUser(OWNER);
  const today = todayBusinessDate();
  const { month } = monthRange((await searchParams).month, today);
  const db = await getDb();
  const runs = await listPayrollRuns(db, user.shopId);
  const paid = runs.find((r) => r.month === month);
  const isCurrent = month === today.slice(0, 7);

  let lines: Line[];
  if (paid) {
    const slips = await getPayslips(db, user.shopId, paid.id);
    lines = (slips?.lines ?? []).map((l) => ({
      ...l,
      key: l.employeeId,
      basis: l.payType === 'daily' ? `${l.daysWorked} day${l.daysWorked === 1 ? '' : 's'}` : 'Monthly',
    }));
  } else {
    lines = (await payrollPreview(db, user.shopId, month))
      .filter((l) => l.grossCents > 0 || l.advancesCents > 0)
      .map((l) => ({
        ...l,
        key: l.employeeId,
        basis:
          l.payType === 'daily'
            ? `${l.daysWorked} day${l.daysWorked === 1 ? '' : 's'} × ${formatKES(l.rateCents)}`
            : `Monthly ${formatKES(l.rateCents)}`,
      }));
  }
  const total = (f: (l: Line) => number) => lines.reduce((n, l) => n + f(l), 0);
  const net = total((l) => l.netCents);
  const statutory = {
    paye: total((l) => l.payeCents),
    nssf: total((l) => l.nssfCents + l.employerNssfCents),
    shif: total((l) => l.shifCents),
    levy: total((l) => l.housingLevyCents + l.employerHousingLevyCents),
  };
  const statutoryDue = statutory.paye + statutory.nssf + statutory.shif + statutory.levy;

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Payroll"
        description={`Wages for ${monthName(month)}`}
        actions={
          paid ? (
            <Button asChild variant="outline" className="h-11 gap-2">
              <Link href={`/payroll/${paid.id}/payslips`}>
                <FileText className="size-4" aria-hidden /> Payslips
              </Link>
            </Button>
          ) : net + total((l) => l.advancesCents) > 0 ? (
            <PostPayrollButton month={month} monthLabel={monthName(month)} netCents={net} />
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
          {formatLongDate(toBusinessDate(paid.postedAt))}
          {paid.postedByName ? ` by ${paid.postedByName}` : ''}.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{paid ? 'Paid' : isCurrent ? 'So far this month' : 'To pay'}</CardTitle>
          <CardDescription>
            Day workers: days present × day rate. Monthly staff: salary, prorated in their first month. Formally employed
            staff have NSSF, SHIF, the housing levy and PAYE taken off, then advances.
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
              gross: formatKES(total((l) => l.grossCents)),
              statutory: minus(total(deductions)),
              advances: minus(total((l) => l.advancesCents)),
              net: <strong>{formatKES(net)}</strong>,
            }}
          />
        </CardContent>
      </Card>

      {statutoryDue > 0 && (
        <Card role="region" aria-label="Statutory deductions">
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Landmark className="size-5 text-primary" aria-hidden /> Owed to KRA, NSSF and SHA
              </CardTitle>
              <CardDescription>
                Employee deductions plus your employer share. Due by {formatLongDate(dueDate(month))}.
              </CardDescription>
            </div>
            {paid && !paid.remittedAt && (
              <RemitStatutoryButton runId={paid.id} dueCents={paid.statutoryDueCents} monthLabel={monthName(month)} />
            )}
          </CardHeader>
          <CardContent className="grid gap-4">
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              {[
                { label: 'PAYE (KRA)', cents: statutory.paye },
                { label: 'NSSF (both shares)', cents: statutory.nssf },
                { label: 'SHIF (SHA)', cents: statutory.shif },
                { label: 'Housing levy (both shares)', cents: statutory.levy },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border p-3">
                  <dt className="text-xs text-muted-foreground">{s.label}</dt>
                  <dd className="mt-1 text-lg font-semibold">{formatKES(s.cents)}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sm">
              Total <strong>{formatKES(statutoryDue)}</strong>
              {paid?.remittedAt
                ? ` · paid over on ${formatLongDate(toBusinessDate(paid.remittedAt))}`
                : paid
                  ? ' · not paid over yet'
                  : ' · becomes due once this payroll is paid'}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
