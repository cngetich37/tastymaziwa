import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { AddCustomerButton, AddSubscriptionButton } from '@/components/dialog-buttons';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { getDb } from '@/db';
import { formatKES, formatLitres } from '@/lib/money';
import { cn } from '@/lib/utils';
import { getOutstandingCredit, getShop, listCustomers } from '@/server/queries';
import { requireUser } from '@/server/session';

export const metadata = { title: 'Customers · TastyMaziwa' };

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'owing', label: 'Owe you' },
  { value: 'subscribed', label: 'Subscriptions' },
] as const;
type Filter = (typeof FILTERS)[number]['value'];

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await requireUser(['owner']);
  const requested = (await searchParams).show;
  const show: Filter = FILTERS.find((f) => f.value === requested)?.value ?? 'all';
  const db = await getDb();
  const [customers, outstanding, shop] = await Promise.all([
    listCustomers(db, user.shopId),
    getOutstandingCredit(db, user.shopId),
    getShop(db, user.shopId),
  ]);

  // One line per customer: the most overdue unpaid sale sets the warning.
  const overdueDays = new Map<string, number>();
  for (const sale of outstanding) {
    overdueDays.set(sale.customerId, Math.max(overdueDays.get(sale.customerId) ?? 0, sale.daysOverdue));
  }
  const totalOwed = customers.reduce((sum, c) => sum + Math.max(0, c.balanceCents), 0);
  const counts: Record<Filter, number> = {
    all: customers.length,
    owing: customers.filter((c) => c.balanceCents > 0).length,
    subscribed: customers.filter((c) => c.subscription).length,
  };
  const shown = customers
    .filter((c) => (show === 'owing' ? c.balanceCents > 0 : show === 'subscribed' ? c.subscription : true))
    // Who to chase first: most overdue, then biggest balance.
    .sort((a, b) =>
      show === 'owing'
        ? (overdueDays.get(b.id) ?? 0) - (overdueDays.get(a.id) ?? 0) || b.balanceCents - a.balanceCents
        : 0,
    );

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Customers"
        description={
          <>
            Customers owe you <span className="font-semibold text-foreground">{formatKES(totalOwed)}</span>
          </>
        }
        actions={
          <>
            <AddCustomerButton />
            {customers.length > 0 && (
              <AddSubscriptionButton customers={customers} defaultPriceCents={shop?.salePricePerLitreCents ?? null} />
            )}
          </>
        }
      />

      <nav aria-label="Filter customers" className="flex gap-2 overflow-x-auto">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={f.value === 'all' ? '/customers' : `/customers?show=${f.value}`}
            aria-current={show === f.value ? 'page' : undefined}
            className={cn(
              'flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium',
              show === f.value ? 'border-primary bg-primary/10 text-primary' : 'bg-background hover:bg-muted',
            )}
          >
            {f.label}
            <span className="text-xs text-muted-foreground tabular-nums">{counts[f.value]}</span>
          </Link>
        ))}
      </nav>

      <Card>
        <CardContent className="py-2">
          {shown.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {customers.length === 0 ? 'No customers yet.' : 'Nobody here. 🎉'}
            </p>
          ) : (
            <ul className="divide-y">
              {shown.map((c) => {
                const overdue = overdueDays.get(c.id) ?? 0;
                return (
                  <li key={c.id}>
                    <Link
                      href={`/customers/${c.id}`}
                      className="-mx-2 flex min-h-16 items-center gap-3 rounded-lg px-2 py-3 hover:bg-muted"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{c.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[c.phone, c.address].filter(Boolean).join(' · ') || 'No contact details'}
                        </p>
                        {(overdue > 0 || c.subscription) && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {overdue > 0 && (
                              <Badge variant="outline" className="border-red-500/40 text-red-600 dark:text-red-400">
                                {overdue} day{overdue === 1 ? '' : 's'} overdue
                              </Badge>
                            )}
                            {c.subscription && (
                              <Badge variant={c.subscription.status === 'active' ? 'secondary' : 'outline'}>
                                {formatLitres(c.subscription.dailyMl)}/day
                                {c.subscription.status === 'paused' && ' · paused'}
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                      <span
                        className={cn(
                          'font-mono text-sm tabular-nums',
                          c.balanceCents > 0 ? 'font-semibold' : 'text-muted-foreground',
                        )}
                      >
                        {formatKES(c.balanceCents)}
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    </Link>
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
