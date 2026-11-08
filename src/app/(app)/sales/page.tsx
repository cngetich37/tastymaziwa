import { Banknote, Droplet, NotebookPen, Plus, Smartphone } from 'lucide-react';
import { DayNav } from '@/components/day-nav';
import { EntryList } from '@/components/entry-list';
import { PageHeader } from '@/components/page-header';
import { RecordDialog } from '@/components/shell/record-dialog';
import { StatCard } from '@/components/stat-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { dayLabel, parseDateParam, todayBusinessDate } from '@/lib/dates';
import { formatKES, formatLitres } from '@/lib/money';
import { getDaySummary, listEntries } from '@/server/queries';
import { requireUser } from '@/server/session';

export const metadata = { title: 'Sales · TastyMaziwa' };

/** One day's sales. Attendants see today only; owners can look back. */
export default async function SalesPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const user = await requireUser();
  const isOwner = user.role === 'owner';
  const today = todayBusinessDate();
  const date = isOwner ? parseDateParam((await searchParams).date, today) : today;
  const db = await getDb();
  const [day, sales] = await Promise.all([
    getDaySummary(db, user.shopId, date),
    listEntries(db, user.shopId, { kinds: ['sale'], date, limit: 500 }),
  ]);

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Sales"
        description={`${dayLabel(date, today)} · ${formatLitres(day.salesMl)} sold for ${formatKES(day.salesCents)}`}
        actions={
          <RecordDialog
            initial="sale"
            defaults={{ date: date === today ? undefined : date }}
            trigger={
              <Button className="h-11 gap-2">
                <Plus className="size-4" aria-hidden /> New sale
              </Button>
            }
          />
        }
      />
      {isOwner && <DayNav date={date} today={today} basePath="/sales" />}

      <section aria-label="Sales figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Litres sold" value={formatLitres(day.salesMl)} icon={Droplet} />
        <StatCard label="Cash" value={formatKES(day.cashSalesCents)} icon={Banknote} detail="Should be in the drawer" />
        <StatCard label="M-Pesa" value={formatKES(day.mpesaSalesCents)} icon={Smartphone} />
        <StatCard label="On credit" value={formatKES(day.creditSalesCents)} icon={NotebookPen} tone={day.creditSalesCents ? 'warning' : 'default'} />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>
            {sales.length} sale{sales.length === 1 ? '' : 's'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EntryList entries={sales} canReverse={isOwner} emptyText="No sales recorded on this day." />
        </CardContent>
      </Card>
    </div>
  );
}
