import { ClipboardCheck } from 'lucide-react';
import { DataTable, type Column } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { CloseReviewButtons, CloseShiftPanel, Variance } from '@/components/shift-close';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { closeVariance } from '@/lib/calc/close';
import { formatShortDate, formatTime } from '@/lib/dates';
import { formatKES, formatQuantity } from '@/lib/money';
import { listShiftCloses, type ShiftCloseItem } from '@/server/queries';
import { requireUser } from '@/server/session';

export const metadata = { title: 'Close shift · TastyMaziwa' };

function Comparison({ c }: { c: ShiftCloseItem }) {
  const v = closeVariance(c);
  const rows = [
    { label: 'Cash', expected: formatKES(c.expectedCashCents), counted: formatKES(c.countedCashCents), v: <Variance value={v.cashCents} kind="cash" /> },
    { label: 'M-Pesa', expected: formatKES(c.expectedMpesaCents), counted: formatKES(c.countedMpesaCents), v: <Variance value={v.mpesaCents} kind="mpesa" /> },
    { label: 'Milk', expected: formatQuantity(c.expectedMilkMl), counted: formatQuantity(c.countedMilkMl), v: <Variance value={v.milkMl} kind="milk" /> },
  ];
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-muted-foreground">
        <tr>
          <th scope="col" className="py-1 text-left font-medium" />
          <th scope="col" className="py-1 text-right font-medium">Expected</th>
          <th scope="col" className="py-1 text-right font-medium">Counted</th>
          <th scope="col" className="py-1 text-right font-medium">Difference</th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {rows.map((r) => (
          <tr key={r.label}>
            <th scope="row" className="py-2 text-left font-medium">{r.label}</th>
            <td className="py-2 text-right">{r.expected}</td>
            <td className="py-2 text-right">{r.counted}</td>
            <td className="py-2 text-right">{r.v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * End of shift. The seller counts the drawer, M-Pesa and milk without seeing
 * the expected figures; the owner sees every close with its differences and
 * signs it off.
 */
export default async function ClosePage() {
  const user = await requireUser();
  const isOwner = user.role === 'owner';
  const closes = await listShiftCloses(await getDb(), user.shopId, { limit: 60 });
  const toReview = closes.filter((c) => c.status === 'submitted');

  const columns: Column<ShiftCloseItem>[] = [
    {
      key: 'when',
      header: 'Closed',
      primary: true,
      cell: (c) => `${formatShortDate(c.businessDate)}, ${formatTime(new Date(c.closedAt))} · ${c.closedByName}`,
    },
    { key: 'cash', header: 'Cash', align: 'right', cell: (c) => <Variance value={closeVariance(c).cashCents} kind="cash" /> },
    { key: 'mpesa', header: 'M-Pesa', align: 'right', cell: (c) => <Variance value={closeVariance(c).mpesaCents} kind="mpesa" /> },
    { key: 'milk', header: 'Milk', align: 'right', cell: (c) => <Variance value={closeVariance(c).milkMl} kind="milk" /> },
    {
      key: 'status',
      header: 'Status',
      cell: (c) =>
        c.status === 'approved' ? (
          <Badge variant="secondary">Signed off{c.reviewedByName ? ` · ${c.reviewedByName}` : ''}</Badge>
        ) : (
          <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
            To check
          </Badge>
        ),
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title="Close shift" description="Count the drawer, M-Pesa and milk, then hand over." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardCheck className="size-5 text-primary" aria-hidden /> Count this shift
            </CardTitle>
            <CardDescription>Count first; you&apos;ll see how it compares after you save.</CardDescription>
          </CardHeader>
          <CardContent>
            <CloseShiftPanel />
          </CardContent>
        </Card>

        {isOwner && (
          <div className="grid content-start gap-4 lg:col-span-3">
            <h2 className="text-lg font-semibold">To sign off ({toReview.length})</h2>
            {toReview.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                Every close is signed off.
              </p>
            ) : (
              toReview.map((c) => (
                <Card key={c.id} role="region" aria-label={`Close by ${c.closedByName}`}>
                  <CardHeader>
                    <CardTitle className="text-base">
                      {c.closedByName} · {formatShortDate(c.businessDate)}, {formatTime(new Date(c.closedAt))}
                    </CardTitle>
                    <CardDescription>
                      Float {formatKES(c.openingFloatCents)}
                      {c.note && <> · “{c.note}”</>}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4">
                    <Comparison c={c} />
                    <CloseReviewButtons closeId={c.id} shortfallMl={Math.max(0, c.expectedMilkMl - c.countedMilkMl)} />
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        )}
      </div>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Recent closes</h2>
        <DataTable label="Recent shift closes" columns={columns} rows={closes} rowKey={(c) => c.id} empty="No shift closed yet." />
      </section>
    </div>
  );
}
