import { CheckCircle2, Hourglass, Truck, Wallet, XCircle } from 'lucide-react';
import { SubmitDeliveryForm } from '@/components/forms/entry-forms';
import { PageHeader } from '@/components/page-header';
import { InstallBanner } from '@/components/pwa';
import { StatCard } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { dayLabel, formatTime, todayBusinessDate } from '@/lib/dates';
import { formatKES, formatLitres } from '@/lib/money';
import { SUPPLIER } from '@/lib/roles';
import { getSupplierPortal } from '@/server/queries';
import { requireUser } from '@/server/session';

export const metadata = { title: 'My deliveries · TastyMaziwa' };

const STATUS = {
  pending: { label: 'Waiting', icon: Hourglass, className: 'text-amber-600 dark:text-amber-400' },
  approved: { label: 'Approved', icon: CheckCircle2, className: 'text-green-700 dark:text-green-400' },
  rejected: { label: 'Rejected', icon: XCircle, className: 'text-red-600 dark:text-red-400' },
} as const;

/**
 * The milkman's page: record what you delivered, then see the shop approve
 * it (or say what was wrong). Shows only this supplier's own account.
 */
export default async function SupplyPage() {
  const user = await requireUser(SUPPLIER);
  const portal = await getSupplierPortal(await getDb(), user.shopId, user.id);
  if (!portal) {
    return (
      <p className="rounded-lg bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
        Your login isn&apos;t linked to a supplier any more. Ask the shop owner.
      </p>
    );
  }
  const { supplier, shopName, submissions } = portal;
  const today = todayBusinessDate();
  const todays = submissions.filter((s) => s.businessDate === today);
  const approvedToday = todays.filter((s) => s.status === 'approved').reduce((n, s) => n + s.volumeMl, 0);
  const waiting = submissions.filter((s) => s.status === 'pending');

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title={`Habari, ${user.name.split(' ')[0]}`} description={`Deliveries to ${shopName}`} />
      <InstallBanner />

      <Card>
        <CardHeader>
          <CardTitle>Record a delivery</CardTitle>
          <CardDescription>The shop checks the litres and approves it. Only approved milk is paid for.</CardDescription>
        </CardHeader>
        <CardContent>
          {supplier.pricePerLitreCents == null && (
            <p className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              The shop hasn&apos;t set your price per litre yet. You can still record deliveries; they&apos;ll be
              approved once it is set.
            </p>
          )}
          <SubmitDeliveryForm priceCents={supplier.pricePerLitreCents} />
        </CardContent>
      </Card>

      <section aria-label="Your figures" className="grid grid-cols-2 gap-3">
        <StatCard
          label="The shop owes you"
          value={formatKES(supplier.payableCents)}
          icon={Wallet}
          detail="Approved deliveries less payments"
        />
        <StatCard
          label="Approved today"
          value={formatLitres(approvedToday)}
          icon={Truck}
          detail={waiting.length ? `${waiting.length} waiting for approval` : undefined}
          tone={waiting.length ? 'warning' : 'default'}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Your deliveries</CardTitle>
          <CardDescription>
            {supplier.pricePerLitreCents != null
              ? `Agreed price ${formatKES(supplier.pricePerLitreCents)} per litre.`
              : 'Newest first.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {submissions.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing recorded yet.</p>
          ) : (
            <ul className="divide-y">
              {submissions.map((s) => {
                const status = STATUS[s.status];
                return (
                  <li key={s.id} className="flex items-start gap-3 py-3">
                    <status.icon className={`mt-0.5 size-5 shrink-0 ${status.className}`} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className={`font-semibold tabular-nums ${s.status === 'rejected' ? 'line-through' : ''}`}>
                          {formatLitres(s.volumeMl)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {dayLabel(s.businessDate, today)}, {formatTime(new Date(s.submittedAt))}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <Badge variant="outline" className="mr-1">
                          {status.label}
                        </Badge>
                        {s.status === 'rejected' && <>“{s.reviewNote}” · {s.reviewedByName}</>}
                        {s.status === 'approved' && <>by {s.reviewedByName}</>}
                        {s.note && <> · {s.note}</>}
                      </p>
                      {s.status === 'rejected' && (
                        <p className="mt-1 text-xs">Please record this delivery again with the right litres.</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
