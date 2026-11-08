import { AddCustomerButton, AddSubscriptionButton, ReceivePaymentButton } from '@/components/dialog-buttons';
import { SubscriptionStatusButtons } from '@/components/subscription-actions';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { formatShortDate } from '@/lib/dates';
import { formatKES, formatLitres } from '@/lib/money';
import { cn } from '@/lib/utils';
import { getLastSalePriceCents, getOutstandingCredit, listCustomers } from '@/server/queries';
import { requireUser } from '@/server/session';

export default async function CreditPage() {
  const user = await requireUser();
  const isOwner = user.role === 'owner';
  const db = await getDb();
  const [outstanding, customers, salePrice] = await Promise.all([
    getOutstandingCredit(db, user.shopId),
    listCustomers(db, user.shopId),
    getLastSalePriceCents(db, user.shopId),
  ]);
  const totalOwed = customers.reduce((sum, c) => sum + Math.max(0, c.balanceCents), 0);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Credit</h1>
        <p className="text-sm text-muted-foreground">
          Customers owe you <span className="font-semibold text-foreground">{formatKES(totalOwed)}</span>
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Unpaid credit sales</CardTitle>
            <CardDescription>Payments are applied to each customer&apos;s oldest sale first.</CardDescription>
          </CardHeader>
          <CardContent>
            {outstanding.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Nobody owes you anything. 🎉</p>
            ) : (
              <ul className="divide-y">
                {outstanding.map((sale) => (
                  <li key={sale.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="font-medium">{sale.customerName}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatLitres(sale.volumeMl)} on {formatShortDate(sale.businessDate)}
                        {sale.status === 'partial' && ` · ${formatKES(sale.paidCents)} paid`}
                      </p>
                      {sale.dueDate && (
                        <p className={cn('text-xs', sale.daysOverdue > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>
                          {sale.daysOverdue > 0
                            ? `${sale.daysOverdue} day${sale.daysOverdue === 1 ? '' : 's'} overdue`
                            : `Due ${formatShortDate(sale.dueDate)}`}
                        </p>
                      )}
                    </div>
                    <span className="font-mono text-sm font-medium tabular-nums">
                      {formatKES(sale.outstandingCents)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>Customers</CardTitle>
            <div className="flex gap-2">
              <AddCustomerButton />
              {isOwner && customers.length > 0 && (
                <AddSubscriptionButton customers={customers} defaultPriceCents={salePrice} />
              )}
            </div>
          </CardHeader>
          <CardContent>
            {customers.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No customers yet.</p>
            ) : (
              <ul className="divide-y">
                {customers.map((c) => (
                  <li key={c.id} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{c.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[c.phone, c.address].filter(Boolean).join(' · ') || 'No contact details'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <span
                          className={cn(
                            'font-mono text-sm tabular-nums',
                            c.balanceCents > 0 ? 'font-semibold' : 'text-muted-foreground',
                          )}
                        >
                          {formatKES(c.balanceCents)}
                        </span>
                        {c.balanceCents > 0 && <ReceivePaymentButton customers={customers} customerId={c.id} />}
                      </div>
                    </div>
                    {c.subscription && (
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <Badge variant={c.subscription.status === 'active' ? 'default' : 'secondary'}>
                          {formatLitres(c.subscription.dailyMl)}/day @ {formatKES(c.subscription.pricePerLitreCents)}
                          {c.subscription.status === 'paused' && ' · paused'}
                        </Badge>
                        {isOwner && (
                          <SubscriptionStatusButtons
                            subscriptionId={c.subscription.id}
                            status={c.subscription.status}
                          />
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
