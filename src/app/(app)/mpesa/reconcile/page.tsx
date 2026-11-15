import { AlertTriangle, CheckCircle2, Inbox, Landmark, Scale } from 'lucide-react';
import { DataTable, type Column } from '@/components/data-table';
import { DayNav } from '@/components/day-nav';
import { PageHeader } from '@/components/page-header';
import { ConnectTillButton, InboxItem, SimulatePayment } from '@/components/reconcile-panels';
import { StatCard } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { formatLongDate, formatTime, parseDateParam, todayBusinessDate, toBusinessDate } from '@/lib/dates';
import { formatKES, formatKESSigned } from '@/lib/money';
import { OWNER } from '@/lib/roles';
import { getTillReconciliation, salesForAmount } from '@/server/mpesa/c2b';
import { getMpesaSettingsSummary } from '@/server/mpesa/payments';
import { listCustomers } from '@/server/queries';
import { requireUser } from '@/server/session';

export const metadata = { title: 'Till reconciliation · TastyMaziwa' };

type Rec = Awaited<ReturnType<typeof getTillReconciliation>>;

const STATUS: Record<Rec['received'][number]['status'], { label: string; tone: 'ok' | 'wait' | 'off' }> = {
  stk: { label: 'STK prompt', tone: 'ok' },
  matched_sale: { label: 'Confirms a sale', tone: 'ok' },
  posted_payment: { label: 'Customer payment', tone: 'ok' },
  unmatched: { label: 'To match', tone: 'wait' },
  ignored: { label: 'Set aside', tone: 'off' },
};

const receivedColumns: Column<Rec['received'][number]>[] = [
  { key: 'when', header: 'Paid', primary: true, cell: (r) => `${formatTime(r.transTime)} · ${formatKES(r.amountCents)}` },
  { key: 'payer', header: 'From', cell: (r) => r.payerName ?? '—' },
  { key: 'receipt', header: 'Receipt', cell: (r) => r.transId },
  {
    key: 'status',
    header: 'Matched',
    cell: (r) => {
      const s = STATUS[r.status];
      return (
        <Badge
          variant="outline"
          className={
            s.tone === 'ok'
              ? 'border-green-600/40 text-green-700 dark:text-green-400'
              : s.tone === 'wait'
                ? 'border-amber-500/50 text-amber-700 dark:text-amber-400'
                : undefined
          }
        >
          {s.label}
          {r.status === 'posted_payment' && r.customerName ? ` · ${r.customerName}` : ''}
        </Badge>
      );
    },
  },
  { key: 'note', header: 'Note', hideOnMobile: true, cell: (r) => r.note ?? (r.matchedByName ? `by ${r.matchedByName}` : '—') },
];

const recordedColumns: Column<Rec['recorded'][number]>[] = [
  {
    key: 'when',
    header: 'Recorded',
    primary: true,
    cell: (r) => `${formatTime(r.occurredAt)} · ${formatKES(r.amountCents)} · ${r.kind === 'sale' ? 'Sale' : 'Payment in'}`,
  },
  { key: 'by', header: 'By', cell: (r) => r.createdByName ?? 'System' },
  {
    key: 'confirmed',
    header: 'Money seen',
    cell: (r) =>
      r.confirmedBy ? (
        <span className="text-green-700 dark:text-green-400">Yes · {r.confirmedBy}</span>
      ) : r.viaPrompt ? (
        <span className="text-green-700 dark:text-green-400">Yes · STK prompt</span>
      ) : (
        <span className="text-amber-700 dark:text-amber-400">Not yet</span>
      ),
  },
];

/**
 * Till / paybill reconciliation: what Safaricom says arrived against what the
 * books say was paid by M-Pesa, the payments still to match, and M-Pesa
 * sales that no money has confirmed.
 */
export default async function ReconcilePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const user = await requireUser(OWNER);
  const today = todayBusinessDate();
  const date = parseDateParam((await searchParams).date, today);
  const db = await getDb();
  const [rec, settings, customers] = await Promise.all([
    getTillReconciliation(db, user.shopId, date),
    getMpesaSettingsSummary(db, user.shopId),
    listCustomers(db, user.shopId),
  ]);
  const inbox = await Promise.all(
    rec.inbox.map(async (p) => ({ ...p, sales: await salesForAmount(db, user.shopId, p.amountCents) })),
  );
  const { totals } = rec;

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Till reconciliation"
        description={`${formatLongDate(date)} · money on the till against M-Pesa in the books`}
        actions={settings ? <ConnectTillButton connected={rec.connected != null} /> : undefined}
      />

      {!settings ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          Set up M-Pesa first (Finance → M-Pesa), then connect your till here.
        </p>
      ) : !rec.connected ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Landmark className="size-5 text-primary" aria-hidden /> Connect your till
            </CardTitle>
            <CardDescription>
              Safaricom will then tell the app about every payment made to{' '}
              {settings.shortcodeType === 'till' ? `till ${settings.tillNumber}` : `paybill ${settings.businessShortcode}`},
              including ones customers send without a prompt.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-green-700 dark:text-green-400" aria-hidden />
          Connected {formatLongDate(toBusinessDate(rec.connected))}
          {rec.environment === 'sandbox' ? ' (sandbox)' : ''}
        </p>
      )}

      {rec.connected && rec.environment === 'sandbox' && <SimulatePayment />}

      <DayNav date={date} today={today} basePath="/mpesa/reconcile" />

      <section aria-label="Reconciliation totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Received on till" value={formatKES(totals.receivedCents)} icon={Landmark} />
        <StatCard label="M-Pesa in the books" value={formatKES(totals.recordedCents)} icon={Scale} />
        <StatCard
          label="Difference"
          value={totals.differenceCents === 0 ? 'None' : formatKESSigned(totals.differenceCents)}
          icon={Scale}
          tone={totals.differenceCents === 0 ? 'positive' : 'warning'}
          detail={totals.differenceCents > 0 ? 'More arrived than was recorded' : totals.differenceCents < 0 ? 'Recorded but not arrived' : undefined}
        />
        <StatCard
          label="Sales with no money"
          value={String(totals.unconfirmed.length)}
          icon={AlertTriangle}
          tone={totals.unconfirmed.length ? 'negative' : 'default'}
          detail="Recorded as M-Pesa over 15 min ago"
        />
      </section>

      <Card role="region" aria-label="Payments to match">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Inbox className="size-5 text-primary" aria-hidden /> Match these payments ({inbox.length})
          </CardTitle>
          <CardDescription>Money that arrived but isn&apos;t in the books yet, from any day.</CardDescription>
        </CardHeader>
        <CardContent>
          {inbox.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Every payment is matched. 👍</p>
          ) : (
            <ul className="grid gap-3">
              {inbox.map((p) => (
                <InboxItem key={p.id} payment={p} customers={customers.map((c) => ({ id: c.id, name: c.name }))} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Received on the till</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable label="Payments received" columns={receivedColumns} rows={rec.received} rowKey={(r) => r.id} empty="Nothing arrived on this day." />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>M-Pesa in the books</CardTitle>
            <CardDescription>Sales and payments recorded as M-Pesa, and whether money confirms them.</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable label="M-Pesa recorded" columns={recordedColumns} rows={rec.recorded} rowKey={(r) => r.id} empty="No M-Pesa recorded on this day." />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
