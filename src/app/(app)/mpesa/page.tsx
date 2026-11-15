import { CheckCircle2, Hourglass, Smartphone, XCircle } from 'lucide-react';
import { DataTable, type Column } from '@/components/data-table';
import { MpesaSettingsButton } from '@/components/finance-panels';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { formatShortDate, formatTime, toBusinessDate, todayBusinessDate } from '@/lib/dates';
import { formatKES, formatQuantity } from '@/lib/money';
import { OWNER } from '@/lib/roles';
import { getMpesaSettingsSummary, listMpesaRequests, type MpesaRequestItem } from '@/server/mpesa/payments';
import { getShop } from '@/server/queries';
import { requireUser } from '@/server/session';

export const metadata = { title: 'M-Pesa · TastyMaziwa' };

const what = (r: MpesaRequestItem) =>
  r.purpose === 'customer_payment'
    ? `Payment from ${r.customerName ?? 'customer'}`
    : `${r.productName ?? 'Milk'} ${formatQuantity(r.volumeMl, r.productUnit ?? 'litre')}${r.customerName ? ` · ${r.customerName}` : ''}`;

const columns: Column<MpesaRequestItem>[] = [
  {
    key: 'when',
    header: 'Sent',
    primary: true,
    cell: (r) => `${formatShortDate(toBusinessDate(r.createdAt))}, ${formatTime(r.createdAt)} · ${formatKES(r.amountCents)}`,
  },
  { key: 'what', header: 'For', cell: what },
  { key: 'phone', header: 'Phone', cell: (r) => r.phone },
  {
    key: 'status',
    header: 'Status',
    cell: (r) =>
      r.status === 'succeeded' ? (
        <Badge variant="secondary" className="gap-1">
          <CheckCircle2 className="size-3.5 text-green-700 dark:text-green-400" aria-hidden /> Paid
        </Badge>
      ) : r.status === 'failed' ? (
        <span className="text-sm text-red-600 dark:text-red-400">{r.resultDesc ?? 'Not paid'}</span>
      ) : (
        <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-700 dark:text-amber-400">
          <Hourglass className="size-3.5" aria-hidden /> Waiting
        </Badge>
      ),
  },
  { key: 'receipt', header: 'Receipt', cell: (r) => r.receiptNumber ?? '—' },
  { key: 'by', header: 'Sent by', hideOnMobile: true, cell: (r) => r.sentByName ?? '—' },
];

/**
 * Lipa na M-Pesa: the shop's Daraja set-up and every prompt sent from the
 * counter with its outcome, for checking against the M-Pesa statement.
 */
export default async function MpesaPage() {
  const user = await requireUser(OWNER);
  const db = await getDb();
  const [saved, requests, shop] = await Promise.all([
    getMpesaSettingsSummary(db, user.shopId),
    listMpesaRequests(db, user.shopId, 200),
    getShop(db, user.shopId),
  ]);
  const today = todayBusinessDate();
  const todays = requests.filter((r) => toBusinessDate(r.createdAt) === today);
  const paidToday = todays.filter((r) => r.status === 'succeeded');

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="M-Pesa"
        description="Payment prompts sent to customers' phones, and what happened to each."
        actions={<MpesaSettingsButton saved={saved} shopName={shop?.name ?? ''} />}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="size-5 text-primary" aria-hidden /> Set-up
          </CardTitle>
          <CardDescription>
            {saved ? (
              <>
                {saved.environment === 'production' ? 'Live' : 'Test (sandbox)'} ·{' '}
                {saved.shortcodeType === 'till' ? `Till ${saved.tillNumber} (store ${saved.businessShortcode})` : `Paybill ${saved.businessShortcode}`} ·
                reference “{saved.accountReference}” · {saved.enabled ? 'prompts on' : 'prompts paused'}
              </>
            ) : (
              'Not set up yet. Sellers can still record M-Pesa sales by hand.'
            )}
          </CardDescription>
        </CardHeader>
        {!saved && (
          <CardContent>
            <ol className="grid list-decimal gap-1.5 pl-5 text-sm">
              <li>Create an app on developer.safaricom.co.ke and try it in the sandbox first (shortcode 174379).</li>
              <li>Use “Go Live” to link your till or paybill; Safaricom sends the live passkey.</li>
              <li>Enter the consumer key, consumer secret and passkey here, and switch Mode to Live.</li>
            </ol>
          </CardContent>
        )}
      </Card>

      <section aria-label="M-Pesa today" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Prompts today" value={String(todays.length)} icon={Smartphone} />
        <StatCard
          label="Paid today"
          value={formatKES(paidToday.reduce((n, r) => n + r.amountCents, 0))}
          icon={CheckCircle2}
          tone="positive"
          detail={`${paidToday.length} paid`}
        />
        <StatCard
          label="Not paid today"
          value={String(todays.filter((r) => r.status === 'failed').length)}
          icon={XCircle}
          tone={todays.some((r) => r.status === 'failed') ? 'warning' : 'default'}
        />
        <StatCard
          label="Waiting"
          value={String(requests.filter((r) => r.status === 'pending').length)}
          icon={Hourglass}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Prompts</CardTitle>
          <CardDescription>Only paid prompts are recorded as sales or payments.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            label="M-Pesa prompts"
            columns={columns}
            rows={requests}
            rowKey={(r) => r.id}
            empty="No prompts sent yet."
          />
        </CardContent>
      </Card>
    </div>
  );
}
