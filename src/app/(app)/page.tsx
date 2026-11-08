import Link from 'next/link';
import { Banknote, Droplet, HandCoins, TrendingUp, Truck } from 'lucide-react';
import { ProfitChart } from '@/components/profit-chart';
import { QuickActions } from '@/components/quick-actions';
import { StatCard } from '@/components/stat-card';
import { EntryList } from '@/components/entry-list';
import { BillSubscriptionsButton } from '@/components/subscription-actions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { formatLongDate } from '@/lib/dates';
import { formatKES, formatLitres } from '@/lib/money';
import {
  getDashboard,
  getLastSalePriceCents,
  listCustomers,
  listEntries,
  listSuppliers,
} from '@/server/queries';
import { requireUser } from '@/server/session';

export default async function DashboardPage() {
  const user = await requireUser();
  const isOwner = user.role === 'owner';
  const db = await getDb();
  const [dash, customers, suppliers, recent, salePrice] = await Promise.all([
    getDashboard(db, user.shopId),
    listCustomers(db, user.shopId),
    listSuppliers(db, user.shopId),
    listEntries(db, user.shopId, { limit: 8 }),
    getLastSalePriceCents(db, user.shopId),
  ]);
  const t = dash.todaySummary;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Today</h1>
        <p className="text-sm text-muted-foreground">{formatLongDate(dash.today)}</p>
      </div>

      <QuickActions customers={customers} suppliers={suppliers} defaultSalePriceCents={salePrice} />

      {dash.activeSubscriptions > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <BillSubscriptionsButton />
          <span className="text-sm text-muted-foreground">
            {dash.activeSubscriptions} active subscription{dash.activeSubscriptions === 1 ? '' : 's'}
          </span>
        </div>
      )}

      <section aria-label="Today's figures" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Sales today"
          value={formatKES(t.salesCents)}
          icon={Banknote}
          detail={`${formatLitres(t.salesMl)} · cash ${formatKES(t.cashSalesCents)} · M-Pesa ${formatKES(t.mpesaSalesCents)} · credit ${formatKES(t.creditSalesCents)}`}
        />
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
          detail={<Link href="/credit" className="underline underline-offset-2">See who owes</Link>}
        />
        {isOwner ? (
          <StatCard
            label="Net profit today"
            value={formatKES(t.netProfitCents)}
            icon={TrendingUp}
            tone={t.netProfitCents < 0 ? 'negative' : 'positive'}
            detail={`7 days: ${formatKES(dash.weekSummary.netProfitCents)}`}
          />
        ) : (
          <StatCard label="Delivered today" value={formatLitres(t.deliveredMl)} icon={Truck} />
        )}
      </section>

      {isOwner && (
        <div className="grid gap-6 lg:grid-cols-3">
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
            detail={<Link href="/settings" className="underline underline-offset-2">Suppliers</Link>}
          />
        </div>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Recent activity</CardTitle>
          <Link href="/ledger" className="text-sm text-primary underline-offset-2 hover:underline">
            Full ledger
          </Link>
        </CardHeader>
        <CardContent>
          <EntryList entries={recent} canReverse={isOwner} />
        </CardContent>
      </Card>
    </div>
  );
}
