import Link from 'next/link';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { PrintButton } from '@/components/report-actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { kraAmount, p9Row, p9Totals, type P9Row } from '@/lib/calc/kra';
import { todayBusinessDate } from '@/lib/dates';
import { OWNER } from '@/lib/roles';
import { getP9Data, getShop } from '@/server/queries';
import { requireUser } from '@/server/session';

export const metadata = { title: 'P9 tax cards · TastyMaziwa' };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** KRA P9A columns (template 2025, Appendix 2A). */
const COLUMNS: { key: keyof P9Row; letter: string; label: string }[] = [
  { key: 'basicCents', letter: 'A', label: 'Basic salary' },
  { key: 'benefitsCents', letter: 'B', label: 'Benefits non-cash' },
  { key: 'quartersCents', letter: 'C', label: 'Value of quarters' },
  { key: 'grossCents', letter: 'D', label: 'Total gross pay' },
  { key: 'e1Cents', letter: 'E1', label: '30% of A' },
  { key: 'e2Cents', letter: 'E2', label: 'Actual (NSSF)' },
  { key: 'e3Cents', letter: 'E3', label: 'Fixed 30,000' },
  { key: 'housingLevyCents', letter: 'F', label: 'AHL' },
  { key: 'shifCents', letter: 'G', label: 'SHIF' },
  { key: 'prmfCents', letter: 'H', label: 'PRMF' },
  { key: 'mortgageInterestCents', letter: 'I', label: 'Owner-occupied interest' },
  { key: 'deductionsCents', letter: 'J', label: 'Total deductions' },
  { key: 'chargeableCents', letter: 'K', label: 'Chargeable pay (D−J)' },
  { key: 'taxChargedCents', letter: 'L', label: 'Tax charged' },
  { key: 'personalReliefCents', letter: 'M', label: 'Personal relief' },
  { key: 'insuranceReliefCents', letter: 'N', label: 'Insurance relief' },
  { key: 'payeCents', letter: 'O', label: 'PAYE tax (L−M−N)' },
];

/**
 * The P9A tax deduction card for each employee with statutory deductions in
 * a calendar year: what they need to file their own return. Print one per
 * page, landscape.
 */
export default async function P9Page({ searchParams }: { searchParams: Promise<{ year?: string; employee?: string }> }) {
  const user = await requireUser(OWNER);
  const sp = await searchParams;
  const thisYear = Number(todayBusinessDate().slice(0, 4));
  const parsed = Number(sp.year);
  const year = Number.isInteger(parsed) && parsed >= 2024 && parsed <= thisYear ? parsed : thisYear;
  const db = await getDb();
  const [all, shop] = await Promise.all([getP9Data(db, user.shopId, year), getShop(db, user.shopId)]);
  const cards = sp.employee ? all.filter((e) => e.employeeId === sp.employee) : all;

  return (
    <div className="grid grid-cols-1 gap-6">
      <Link href="/payroll" className="-mb-3 flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden">
        <ArrowLeft className="size-4" aria-hidden /> Payroll
      </Link>
      <PageHeader
        title="P9 tax cards"
        description={`KRA P9A tax deduction cards for ${year}. Give each employee theirs for their annual return.`}
        actions={<PrintButton />}
      />

      <nav aria-label="Choose a year" className="flex flex-wrap items-center gap-2 print:hidden">
        <Button asChild variant="outline" size="icon" className="size-11">
          <Link href={`/payroll/p9?year=${year - 1}`} aria-label="Previous year">
            <ChevronLeft className="size-5" aria-hidden />
          </Link>
        </Button>
        <span className="min-w-16 text-center font-medium">{year}</span>
        {year < thisYear ? (
          <Button asChild variant="outline" size="icon" className="size-11">
            <Link href={`/payroll/p9?year=${year + 1}`} aria-label="Next year">
              <ChevronRight className="size-5" aria-hidden />
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="icon" className="size-11" disabled aria-label="Next year">
            <ChevronRight className="size-5" aria-hidden />
          </Button>
        )}
        {all.length > 1 && (
          <ul className="ml-2 flex flex-wrap gap-2">
            {[{ id: '', name: 'Everyone' }, ...all.map((e) => ({ id: e.employeeId, name: e.name }))].map((e) => (
              <li key={e.id}>
                <Link
                  href={`/payroll/p9?year=${year}${e.id ? `&employee=${e.id}` : ''}`}
                  className={`inline-flex h-11 items-center rounded-full border px-4 text-sm ${
                    (sp.employee ?? '') === e.id ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'
                  }`}
                >
                  {e.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </nav>

      {cards.length === 0 && (
        <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          No one had PAYE, NSSF, SHIF or housing levy deducted in {year}.
        </p>
      )}

      {cards.map((e) => {
        const rows = MONTHS.map((_, i) => {
          const line = e.months.get(`${year}-${String(i + 1).padStart(2, '0')}`);
          return line ? p9Row(line) : null;
        });
        const totals = p9Totals(rows.filter((r): r is P9Row => r != null));
        return (
          <Card key={e.employeeId} role="region" aria-label={`P9 for ${e.name}`} className="break-after-page break-inside-avoid">
            <CardHeader>
              <p className="text-xs text-muted-foreground">Kenya Revenue Authority · Tax deduction card (P9A) · Year {year}</p>
              <CardTitle className="text-xl">{e.name}</CardTitle>
              <p className="text-sm text-muted-foreground">
                Employee PIN {e.kraPin ?? '— (add it under Staff)'} · Employer {shop?.name}
              </p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-max text-xs">
                  <thead className="bg-muted/60 text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-2 py-2 text-left font-medium">
                        Month
                      </th>
                      {COLUMNS.map((c) => (
                        <th key={c.key} scope="col" className="px-2 py-2 text-right font-medium">
                          <span className="block font-semibold text-foreground">{c.letter}</span>
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {MONTHS.map((m, i) => (
                      <tr key={m}>
                        <th scope="row" className="px-2 py-1.5 text-left font-medium">
                          {m}
                        </th>
                        {COLUMNS.map((c) => (
                          <td key={c.key} className="px-2 py-1.5 text-right tabular-nums">
                            {rows[i] ? kraAmount(rows[i]![c.key]) : ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 bg-muted/40 font-semibold">
                    <tr>
                      <th scope="row" className="px-2 py-2 text-left">
                        Total
                      </th>
                      {COLUMNS.map((c) => (
                        <td key={c.key} className="px-2 py-2 text-right tabular-nums">
                          {c.key === 'e3Cents' ? '' : kraAmount(totals[c.key])}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
              <dl className="mt-4 grid gap-1 text-sm sm:grid-cols-2">
                <div className="flex justify-between gap-3 sm:justify-start">
                  <dt>Total chargeable pay (col. K)</dt>
                  <dd className="font-semibold">Ksh {kraAmount(totals.chargeableCents)}</dd>
                </div>
                <div className="flex justify-between gap-3 sm:justify-start">
                  <dt>Total tax (col. O)</dt>
                  <dd className="font-semibold">Ksh {kraAmount(totals.payeCents)}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">
                Pension deduction (E) is the lowest of E1, E2 and E3. Personal relief is Ksh 2,400 a month. SHIF and AHL
                are deductible from December 2024.
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
