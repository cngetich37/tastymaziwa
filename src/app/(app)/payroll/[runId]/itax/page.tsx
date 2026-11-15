import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Landmark } from 'lucide-react';
import { z } from 'zod';
import { DataTable, type Column } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { DownloadTextButton } from '@/components/report-actions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { p9Row, sheetBRow, toSheetBCsv } from '@/lib/calc/kra';
import { formatKES } from '@/lib/money';
import { OWNER } from '@/lib/roles';
import { getPayslips, type Payslip } from '@/server/queries';
import { requireUser } from '@/server/session';

export const metadata = { title: 'iTax PAYE return · TastyMaziwa' };

const monthName = (m: string) =>
  new Intl.DateTimeFormat('en-KE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));

const hasStatutory = (l: Payslip) => l.nssfCents + l.shifCents + l.housingLevyCents + l.payeCents > 0;

const columns: Column<Payslip>[] = [
  { key: 'name', header: 'Employee', primary: true, cell: (l) => l.name },
  { key: 'pin', header: 'KRA PIN', cell: (l) => l.kraPin },
  { key: 'gross', header: 'Gross (H)', align: 'right', cell: (l) => formatKES(l.grossCents) },
  { key: 'shif', header: 'SHIF (I)', align: 'right', cell: (l) => formatKES(l.shifCents) },
  { key: 'nssf', header: 'NSSF (J)', align: 'right', cell: (l) => formatKES(l.nssfCents) },
  { key: 'ahl', header: 'AHL (N)', align: 'right', cell: (l) => formatKES(l.housingLevyCents) },
  { key: 'taxable', header: 'Taxable (O)', align: 'right', cell: (l) => formatKES(p9Row(l).chargeableCents) },
  { key: 'paye', header: 'PAYE (R)', align: 'right', cell: (l) => <strong>{formatKES(l.payeCents)}</strong> },
];

/**
 * The month's PAYE return for iTax: the simplified return's Sheet B rows as a
 * CSV for the template's Import CSV button, and the Sheet E totals to check
 * against before validating and generating the payment slip.
 */
export default async function ItaxReturnPage({ params }: { params: Promise<{ runId: string }> }) {
  const user = await requireUser(OWNER);
  const runId = z.uuid().safeParse((await params).runId);
  if (!runId.success) notFound();
  const data = await getPayslips(await getDb(), user.shopId, runId.data);
  if (!data) notFound();
  const { run } = data;
  const formal = data.lines.filter(hasStatutory);
  const withPin = formal.filter((l) => l.kraPin);
  const noPin = formal.filter((l) => !l.kraPin);
  const sum = (ls: Payslip[], f: (l: Payslip) => number) => ls.reduce((n, l) => n + f(l), 0);

  const csv = toSheetBCsv(withPin.map((l) => sheetBRow({ kraPin: l.kraPin!, name: l.name }, l)));
  const sheetE = [
    { n: 1, label: 'Total employees (Sheet B)', value: String(withPin.length) },
    { n: 2, label: 'PAYE deducted from employees (Sheet B)', value: formatKES(sum(withPin, (l) => l.payeCents)) },
    { n: 5, label: 'PAYE deducted from employees without a PIN', value: formatKES(sum(noPin, (l) => l.payeCents)) },
    {
      n: 7,
      label: 'Housing levy (employee + employer)',
      value: formatKES(sum(formal, (l) => l.housingLevyCents + l.employerHousingLevyCents)),
    },
    { n: 9, label: 'NITA levy (KES 50 × employees)', value: formatKES(sum(formal, (l) => l.employerNitaCents)) },
  ];

  return (
    <div className="grid grid-cols-1 gap-6">
      <Link href={`/payroll?month=${run.month}`} className="-mb-3 flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Payroll
      </Link>
      <PageHeader
        title="iTax PAYE return"
        description={`Simplified PAYE return (P10) for ${monthName(run.month)} · due by the 9th of the next month`}
        actions={
          withPin.length > 0 ? (
            <DownloadTextButton content={csv} filename={`paye-sheet-b-${run.month}.csv`} label="Sheet B CSV" />
          ) : undefined
        }
      />

      {noPin.length > 0 && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <span>
            No KRA PIN for {noPin.map((l) => l.name).join(', ')}, so they are left out of Sheet B. Declare their PAYE on
            Sheet E row 5, then add the PIN under Staff and amend the return.
          </span>
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Sheet B: employee details</CardTitle>
          <CardDescription>
            Cash wages only, every employee a resident primary employee with no PWD exemption. The CSV follows the
            template’s 25 columns in order, without a header row.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            label="Sheet B employee details"
            columns={columns}
            rows={withPin}
            rowKey={(l) => l.employeeId}
            empty="Nobody with a KRA PIN had PAYE deductions this month."
          />
        </CardContent>
      </Card>

      <Card role="region" aria-label="Sheet E tax due">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Landmark className="size-5 text-primary" aria-hidden /> Sheet E: tax due
          </CardTitle>
          <CardDescription>The template fills these in; check they match before you validate.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="divide-y text-sm">
            {sheetE.map((r) => (
              <div key={r.n} className="flex items-baseline justify-between gap-3 py-2">
                <dt>
                  <span className="mr-2 text-muted-foreground">{r.n}.</span>
                  {r.label}
                </dt>
                <dd className="font-semibold tabular-nums">{r.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How to file</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="grid list-decimal gap-2 pl-5 text-sm">
            <li>On iTax, download the simplified PAYE return (Excel) for {monthName(run.month)}.</li>
            <li>Sheet A: your employer PIN, original return, the month as the period, and “No” to lump sums.</li>
            <li>Sheet B: use <strong>Import CSV</strong> and choose the Sheet B CSV from this page.</li>
            <li>Sheet E: compare the totals with the ones above, then validate and upload the return.</li>
            <li>Pay with the payment slip (PRN) via M-Pesa paybill 222222, then tap Record payment on the payroll page.</li>
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">
            Built for KRA’s simplified return template (v30, July 2025). If KRA changes the template, compare it with
            their sample CSV on kra.go.ke/publications.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
