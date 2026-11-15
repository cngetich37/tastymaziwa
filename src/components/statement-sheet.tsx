import Link from 'next/link';
import { ArrowLeft, MessageCircle } from 'lucide-react';
import { DataTable, type Column } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { RangePicker } from '@/components/range-picker';
import { PrintButton } from '@/components/report-actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { DateRange } from '@/lib/calc/reports';
import type { PeriodStatement } from '@/lib/calc/statement';
import { formatShortDate, type BusinessDate } from '@/lib/dates';
import { formatKES, formatQuantity } from '@/lib/money';
import type { LedgerListItem } from '@/server/queries';

export type StatementLine = LedgerListItem & { effectCents: number; balanceCents: number };

const DETAIL: Record<string, string> = {
  sale: 'Milk bought',
  customer_payment: 'Payment received',
  delivery: 'Milk delivered',
  supplier_payment: 'Payment made',
};

function details(l: StatementLine): string {
  const parts = [l.kind === 'sale' && l.paymentMethod !== 'credit' ? `Paid ${l.paymentMethod === 'mpesa' ? 'by M-Pesa' : 'in cash'}` : DETAIL[l.kind]];
  if (l.productName) parts[0] = l.productName;
  if (l.volumeMl) parts.push(formatQuantity(Math.abs(l.volumeMl), l.productUnit ?? 'litre'));
  if (l.reversesId) parts.push('correction');
  if (l.note && !l.reversesId) parts.push(l.note);
  return parts.join(' · ');
}

/**
 * A printable account statement for one period: who it is for, the balance
 * brought forward, every line with its running balance, and the balance due.
 * Print it, save it as PDF, or (for customers) send the total by WhatsApp.
 */
export function StatementSheet({
  party,
  backHref,
  name,
  phone,
  shopName,
  range,
  today,
  basePath,
  statement,
}: {
  party: 'customer' | 'supplier';
  backHref: string;
  name: string;
  phone: string | null;
  shopName: string;
  range: DateRange;
  today: BusinessDate;
  basePath: string;
  statement: PeriodStatement<StatementLine>;
}) {
  const owedLabel = party === 'customer' ? `${name} owes` : `You owe ${name}`;
  const columns: Column<StatementLine>[] = [
    { key: 'date', header: 'Date', primary: true, cell: (l) => `${formatShortDate(l.businessDate)} · ${details(l)}` },
    {
      key: 'charge',
      header: party === 'customer' ? 'On credit' : 'Delivered',
      align: 'right',
      cell: (l) => (l.effectCents > 0 ? formatKES(l.effectCents) : l.effectCents === 0 ? formatKES(l.amountCents) : ''),
    },
    { key: 'paid', header: 'Paid', align: 'right', cell: (l) => (l.effectCents < 0 ? formatKES(-l.effectCents) : '') },
    { key: 'balance', header: 'Balance', align: 'right', cell: (l) => formatKES(l.balanceCents) },
  ];
  const period = range.from === range.to ? formatShortDate(range.from) : `${formatShortDate(range.from)} – ${formatShortDate(range.to)}`;
  const whatsapp =
    party === 'customer' && phone
      ? `https://wa.me/${phone.replace(/^\+/, '')}?text=${encodeURIComponent(
          `Habari ${name.split(' ')[0]}, your ${shopName} statement for ${period}: balance ${formatKES(statement.closingCents)}. Asante!`,
        )}`
      : null;

  return (
    <div className="grid grid-cols-1 gap-6">
      <Link href={backHref} className="-mb-3 flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden">
        <ArrowLeft className="size-4" aria-hidden /> {name}
      </Link>
      <PageHeader
        title="Statement"
        description={
          <>
            <span className="font-medium text-foreground">{name}</span> · {shopName} · {period}
          </>
        }
        actions={
          <>
            {whatsapp && (
              <Button asChild variant="outline" className="h-11 gap-2 print:hidden">
                <a href={whatsapp} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="size-4" aria-hidden /> Send on WhatsApp
                </a>
              </Button>
            )}
            <PrintButton />
          </>
        }
      />
      <RangePicker basePath={basePath} range={range} today={today} />

      <section aria-label="Statement totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Brought forward', value: statement.openingCents },
          { label: party === 'customer' ? 'Bought on credit' : 'Delivered', value: statement.chargesCents },
          { label: 'Paid', value: statement.paymentsCents },
          { label: owedLabel, value: statement.closingCents, strong: true },
        ].map((t) => (
          <div key={t.label} className={t.strong ? 'rounded-xl border border-primary/40 bg-primary/5 p-4' : 'rounded-xl border bg-card p-4'}>
            <p className="text-sm text-muted-foreground">{t.label}</p>
            <p className="mt-1 text-xl font-bold">{formatKES(t.value)}</p>
          </div>
        ))}
      </section>

      <Card>
        <CardContent className="pt-6">
          <DataTable
            label="Statement lines"
            columns={columns}
            rows={statement.lines}
            rowKey={(l) => l.id}
            empty="Nothing happened on this account in the period."
            footer={{ date: 'Balance due', balance: formatKES(statement.closingCents) }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
