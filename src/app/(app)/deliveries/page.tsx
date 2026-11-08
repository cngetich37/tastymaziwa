import { Droplet, Droplets, Plus, Truck, Wallet } from 'lucide-react';
import { DayNav } from '@/components/day-nav';
import { EntryList } from '@/components/entry-list';
import { PageHeader } from '@/components/page-header';
import { RecordDialog } from '@/components/shell/record-dialog';
import { StatCard } from '@/components/stat-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { dayLabel, nairobiHour, parseDateParam, todayBusinessDate } from '@/lib/dates';
import { formatKES, formatLitres } from '@/lib/money';
import {
  getDaySummary,
  getDeliveriesBySupplier,
  getStockOnHandMl,
  listEntries,
  type LedgerListItem,
} from '@/server/queries';
import { requireUser } from '@/server/session';

export const metadata = { title: 'Deliveries · TastyMaziwa' };

/** Milk usually comes twice a day; noon splits the morning and evening runs. */
const isMorning = (e: LedgerListItem) => nairobiHour(new Date(e.occurredAt)) < 12;

export default async function DeliveriesPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const user = await requireUser();
  const isOwner = user.role === 'owner';
  const today = todayBusinessDate();
  const date = isOwner ? parseDateParam((await searchParams).date, today) : today;
  const dateDefault = { date: date === today ? undefined : date };
  const db = await getDb();
  const [day, entries, bySupplier, stockMl] = await Promise.all([
    getDaySummary(db, user.shopId, date),
    listEntries(db, user.shopId, { kinds: isOwner ? ['delivery', 'spoilage'] : ['delivery'], date, limit: 500 }),
    getDeliveriesBySupplier(db, user.shopId, date),
    getStockOnHandMl(db, user.shopId),
  ]);
  const deliveries = entries.filter((e) => e.kind === 'delivery');
  const spoilage = entries.filter((e) => e.kind === 'spoilage');
  const runs = [
    { title: 'Morning', items: deliveries.filter(isMorning) },
    { title: 'Evening', items: deliveries.filter((e) => !isMorning(e)) },
  ];

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Deliveries"
        description={`${dayLabel(date, today)} · ${formatLitres(day.deliveredMl)} received`}
        actions={
          <>
            {isOwner && (
              <RecordDialog
                initial="spoilage"
                defaults={dateDefault}
                trigger={
                  <Button variant="outline" className="h-11 gap-2">
                    <Droplets className="size-4" aria-hidden /> Spoilage
                  </Button>
                }
              />
            )}
            <RecordDialog
              initial="delivery"
              defaults={dateDefault}
              trigger={
                <Button className="h-11 gap-2">
                  <Plus className="size-4" aria-hidden /> New delivery
                </Button>
              }
            />
          </>
        }
      />
      {isOwner && <DayNav date={date} today={today} basePath="/deliveries" />}

      <section aria-label="Delivery figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Milk received" value={formatLitres(day.deliveredMl)} icon={Truck} />
        <StatCard
          label="In stock now"
          value={formatLitres(stockMl)}
          icon={Droplet}
          tone={stockMl < 0 ? 'warning' : 'default'}
          detail={stockMl < 0 ? 'A delivery may be missing' : undefined}
        />
        <StatCard label="Spoiled" value={formatLitres(day.spoiledMl)} icon={Droplets} tone={day.spoiledMl ? 'warning' : 'default'} />
        {isOwner && <StatCard label="Cost of milk" value={formatKES(day.deliveryCostCents)} icon={Wallet} />}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>
              {deliveries.length} deliver{deliveries.length === 1 ? 'y' : 'ies'}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {deliveries.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No milk received on this day.</p>
            ) : (
              runs
                .filter((r) => r.items.length > 0)
                .map((run) => (
                  <section key={run.title} aria-label={`${run.title} deliveries`}>
                    <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                      {run.title} · {formatLitres(run.items.reduce((sum, e) => sum + e.volumeMl, 0))}
                    </h3>
                    <EntryList entries={run.items} canReverse={isOwner} hideCosts={!isOwner} />
                  </section>
                ))
            )}
          </CardContent>
        </Card>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>By supplier</CardTitle>
            </CardHeader>
            <CardContent>
              {bySupplier.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing yet.</p>
              ) : (
                <ul className="divide-y">
                  {bySupplier.map((s) => (
                    <li key={s.supplierId} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="truncate font-medium">{s.name}</span>
                      <span className="text-right tabular-nums">
                        {formatLitres(s.volumeMl)}
                        {isOwner && <span className="block text-xs text-muted-foreground">{formatKES(s.amountCents)}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          {isOwner && (
            <Card>
              <CardHeader>
                <CardTitle>Spoilage</CardTitle>
                <CardDescription>Milk written off on this day.</CardDescription>
              </CardHeader>
              <CardContent>
                <EntryList entries={spoilage} canReverse emptyText="Nothing spoiled. 👍" />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
