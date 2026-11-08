import Link from 'next/link';
import { Banknote, CheckCircle2, Circle, Droplet, HandCoins, Lock, TrendingUp, Truck } from 'lucide-react';
import { EntryList } from '@/components/entry-list';
import { PageHeader } from '@/components/page-header';
import { ProfitChart } from '@/components/profit-chart';
import { QuickActions } from '@/components/quick-actions';
import { StatCard } from '@/components/stat-card';
import { BillSubscriptionsButton } from '@/components/subscription-actions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { formatLongDate } from '@/lib/dates';
import { formatKES, formatLitres } from '@/lib/money';
import { cn } from '@/lib/utils';
import { getDashboard, getShop, listEntries, listSuppliers } from '@/server/queries';
import { requireUser } from '@/server/session';

const salesDetail = (t: { salesMl: number; cashSalesCents: number; mpesaSalesCents: number; creditSalesCents: number }) =>
  `${formatLitres(t.salesMl)} · cash ${formatKES(t.cashSalesCents)} · M-Pesa ${formatKES(t.mpesaSalesCents)} · credit ${formatKES(t.creditSalesCents)}`;

/** Until prices are in place, attendants can't record anything: walk the owner through it. */
function SetupChecklist({ steps }: { steps: { done: boolean; label: string; href: string }[] }) {
  if (steps.every((s) => s.done)) return null;
  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardHeader>
        <CardTitle>Get your shop ready</CardTitle>
        <CardDescription>Attendants record litres only, at the prices you set here.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-1">
          {steps.map((s) => (
            <li key={s.label}>
              <Link
                href={s.href}
                className={cn(
                  'flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm hover:bg-muted',
                  s.done && 'text-muted-foreground line-through',
                )}
              >
                {s.done ? (
                  <CheckCircle2 className="size-5 shrink-0 text-green-600 dark:text-green-400" aria-hidden />
                ) : (
                  <Circle className="size-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                )}
                <span className="sr-only">{s.done ? 'Done: ' : 'To do: '}</span>
                {s.label}
              </Link>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const isOwner = user.role === 'owner';
  const db = await getDb();
  const [dash, shop] = await Promise.all([getDashboard(db, user.shopId), getShop(db, user.shopId)]);
  const t = dash.todaySummary;
  const price = shop?.salePricePerLitreCents ?? null;

  if (!isOwner) {
    // The counter view: what an attendant records and must hand over.
    const recent = await listEntries(db, user.shopId, { kinds: ['sale', 'delivery'], date: dash.today, limit: 20 });
    return (
      <div className="grid grid-cols-1 gap-6">
        <PageHeader title="Today" description={formatLongDate(dash.today)} />
        <QuickActions />
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Lock className="size-4" aria-hidden />
          {price != null ? (
            <>
              Selling at <span className="font-semibold text-foreground">{formatKES(price)}</span> per litre, set by
              the owner.
            </>
          ) : (
            'The owner has not set a selling price yet.'
          )}
        </p>
        <section aria-label="Today's figures" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Sold today" value={formatLitres(t.salesMl)} icon={Droplet} detail={`${formatKES(t.salesCents)} in sales`} />
          <StatCard
            label="Cash to hand over"
            value={formatKES(t.cashSalesCents)}
            icon={Banknote}
            detail={`Plus M-Pesa ${formatKES(t.mpesaSalesCents)} · credit ${formatKES(t.creditSalesCents)}`}
          />
          <StatCard
            label="Milk in stock"
            value={formatLitres(dash.stockOnHandMl)}
            icon={Droplet}
            tone={dash.stockOnHandMl < 0 ? 'warning' : 'default'}
            detail={dash.stockOnHandMl < 0 ? 'More sold than received: is a delivery missing?' : undefined}
          />
          <StatCard label="Received today" value={formatLitres(t.deliveredMl)} icon={Truck} />
        </section>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Today&apos;s entries</CardTitle>
            <Link href="/sales" className="text-sm text-primary underline-offset-2 hover:underline">
              All sales
            </Link>
          </CardHeader>
          <CardContent>
            <EntryList entries={recent} hideCosts emptyText="Nothing recorded yet today." />
          </CardContent>
        </Card>
      </div>
    );
  }

  const [recent, suppliers] = await Promise.all([
    listEntries(db, user.shopId, { limit: 8 }),
    listSuppliers(db, user.shopId),
  ]);

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title="Today" description={formatLongDate(dash.today)} />

      <SetupChecklist
        steps={[
          { done: price != null, label: 'Set your selling price per litre', href: '/settings' },
          { done: suppliers.length > 0, label: 'Add the milkman you buy from', href: '/suppliers' },
          {
            done: suppliers.length > 0 && suppliers.every((s) => s.defaultPricePerLitreCents != null),
            label: 'Agree a buying price with each supplier',
            href: '/suppliers',
          },
        ]}
      />

      <QuickActions />

      {dash.activeSubscriptions > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <BillSubscriptionsButton />
          <span className="text-sm text-muted-foreground">
            {dash.activeSubscriptions} active subscription{dash.activeSubscriptions === 1 ? '' : 's'}
          </span>
        </div>
      )}

      <section aria-label="Today's figures" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Sales today" value={formatKES(t.salesCents)} icon={Banknote} detail={salesDetail(t)} />
        <StatCard
          label="Milk in stock"
          value={formatLitres(dash.stockOnHandMl)}
          icon={Droplet}
          tone={dash.stockOnHandMl < 0 ? 'warning' : 'default'}
          detail={
            dash.stockOnHandMl < 0
              ? 'More sold than received — a delivery may be missing'
              : `In ${formatLitres(t.deliveredMl)} · spoiled ${formatLitres(t.spoiledMl)} today`
          }
        />
        <StatCard
          label="Customers owe you"
          value={formatKES(dash.receivablesCents)}
          icon={HandCoins}
          detail={
            <Link href="/customers?show=owing" className="underline underline-offset-2">
              See who owes
            </Link>
          }
        />
        <StatCard
          label="Net profit today"
          value={formatKES(t.netProfitCents)}
          icon={TrendingUp}
          tone={t.netProfitCents < 0 ? 'negative' : 'positive'}
          detail={`7 days: ${formatKES(dash.weekSummary.netProfitCents)}`}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Net profit, last 7 days</CardTitle>
            <CardDescription>Sales minus milk cost and expenses, per day.</CardDescription>
          </CardHeader>
          <CardContent>
            <ProfitChart data={dash.series} />
          </CardContent>
        </Card>
        <StatCard
          label="You owe suppliers"
          value={formatKES(dash.payablesCents)}
          icon={Truck}
          tone={dash.payablesCents > 0 ? 'warning' : 'default'}
          detail={
            <Link href="/suppliers" className="underline underline-offset-2">
              Suppliers
            </Link>
          }
        />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Recent activity</CardTitle>
          <Link href="/ledger" className="text-sm text-primary underline-offset-2 hover:underline">
            Full ledger
          </Link>
        </CardHeader>
        <CardContent>
          <EntryList entries={recent} canReverse />
        </CardContent>
      </Card>
    </div>
  );
}
