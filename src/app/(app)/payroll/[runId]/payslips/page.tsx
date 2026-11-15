import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, MessageCircle } from 'lucide-react';
import { z } from 'zod';
import { PageHeader } from '@/components/page-header';
import { PrintButton } from '@/components/report-actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { formatLongDate, toBusinessDate } from '@/lib/dates';
import { formatKES } from '@/lib/money';
import { OWNER } from '@/lib/roles';
import { getPayslips, getShop, type Payslip } from '@/server/queries';
import { requireUser } from '@/server/session';

export const metadata = { title: 'Payslips · TastyMaziwa' };

const monthName = (m: string) =>
  new Intl.DateTimeFormat('en-KE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));

function Row({ label, cents, minus, strong }: { label: string; cents: number; minus?: boolean; strong?: boolean }) {
  return (
    <div className={strong ? 'flex justify-between gap-3 border-t pt-2 font-semibold' : 'flex justify-between gap-3'}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{minus && cents ? `−${formatKES(cents)}` : formatKES(cents)}</dd>
    </div>
  );
}

function whatsappLink(slip: Payslip, shopName: string, month: string) {
  if (!slip.phone) return null;
  const deductions = slip.nssfCents + slip.shifCents + slip.housingLevyCents + slip.payeCents;
  const text = [
    `Habari ${slip.name.split(' ')[0]}, your ${shopName} payslip for ${monthName(month)}:`,
    `Earned ${formatKES(slip.grossCents)}`,
    deductions ? `NSSF ${formatKES(slip.nssfCents)}, SHIF ${formatKES(slip.shifCents)}, housing levy ${formatKES(slip.housingLevyCents)}, PAYE ${formatKES(slip.payeCents)}` : null,
    slip.advancesCents ? `Advances ${formatKES(slip.advancesCents)}` : null,
    `Paid ${formatKES(slip.netCents)}. Asante!`,
  ]
    .filter(Boolean)
    .join('\n');
  return `https://wa.me/${slip.phone.replace(/^\+/, '')}?text=${encodeURIComponent(text)}`;
}

/** One payslip per person for a payroll run: print (one per page), save as PDF, or send by WhatsApp. */
export default async function PayslipsPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ employee?: string }>;
}) {
  const user = await requireUser(OWNER);
  const runId = z.uuid().safeParse((await params).runId);
  if (!runId.success) notFound();
  const employee = z.uuid().safeParse((await searchParams).employee);
  const db = await getDb();
  const [data, shop] = await Promise.all([
    getPayslips(db, user.shopId, runId.data, employee.success ? employee.data : undefined),
    getShop(db, user.shopId),
  ]);
  if (!data) notFound();
  const { run, lines } = data;
  const shopName = shop?.name ?? 'TastyMaziwa';

  return (
    <div className="grid grid-cols-1 gap-6">
      <Link href={`/payroll?month=${run.month}`} className="-mb-3 flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden">
        <ArrowLeft className="size-4" aria-hidden /> Payroll
      </Link>
      <PageHeader title="Payslips" description={`${shopName} · ${monthName(run.month)}`} actions={<PrintButton />} />

      <ul className="grid gap-6 lg:grid-cols-2">
        {lines.map((slip) => {
          const statutory = slip.nssfCents + slip.shifCents + slip.housingLevyCents + slip.payeCents > 0;
          const wa = whatsappLink(slip, shopName, run.month);
          return (
            <li key={slip.employeeId} className="break-after-page break-inside-avoid">
              <Card aria-label={`Payslip for ${slip.name}`} role="region">
                <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {shopName} · Payslip · {monthName(run.month)}
                    </p>
                    <CardTitle className="mt-1 text-xl">{slip.name}</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[
                        slip.kraPin && `KRA PIN ${slip.kraPin}`,
                        slip.nssfNumber && `NSSF ${slip.nssfNumber}`,
                        slip.shaNumber && `SHA ${slip.shaNumber}`,
                      ]
                        .filter(Boolean)
                        .join(' · ') || (slip.payType === 'daily' ? `Day rate ${formatKES(slip.rateCents)}` : `Monthly ${formatKES(slip.rateCents)}`)}
                    </p>
                  </div>
                  {wa && (
                    <Button asChild variant="outline" className="h-11 gap-2 print:hidden">
                      <a href={wa} target="_blank" rel="noopener noreferrer">
                        <MessageCircle className="size-4" aria-hidden /> WhatsApp
                      </a>
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="grid gap-4 text-sm">
                  <dl className="grid gap-1.5">
                    <Row
                      label={slip.payType === 'daily' ? `Earned (${slip.daysWorked} day${slip.daysWorked === 1 ? '' : 's'})` : 'Salary'}
                      cents={slip.grossCents}
                    />
                    {statutory && (
                      <>
                        <Row label="NSSF" cents={slip.nssfCents} minus />
                        <Row label="SHIF" cents={slip.shifCents} minus />
                        <Row label="Housing levy" cents={slip.housingLevyCents} minus />
                        <Row label={`PAYE (on taxable ${formatKES(slip.taxableCents)})`} cents={slip.payeCents} minus />
                      </>
                    )}
                    {slip.advancesCents > 0 && <Row label="Advances" cents={slip.advancesCents} minus />}
                    <Row label="Net pay" cents={slip.netCents} strong />
                  </dl>
                  {statutory && (
                    <p className="text-xs text-muted-foreground">
                      Employer also paid NSSF {formatKES(slip.employerNssfCents)} and housing levy{' '}
                      {formatKES(slip.employerHousingLevyCents)}. PAYE is after personal relief of Ksh 2,400.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Paid by {run.paymentMethod === 'mpesa' ? 'M-Pesa' : 'cash'} on {formatLongDate(toBusinessDate(run.postedAt))}.
                  </p>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
