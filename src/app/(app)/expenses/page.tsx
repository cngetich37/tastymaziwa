import Link from 'next/link';
import { ChevronLeft, ChevronRight, Plus, Receipt, Target, TriangleAlert } from 'lucide-react';
import { DataTable, type Column } from '@/components/data-table';
import { EntryList } from '@/components/entry-list';
import { BudgetsButton } from '@/components/finance-panels';
import { PageHeader } from '@/components/page-header';
import { RecordDialog } from '@/components/shell/record-dialog';
import { StatCard } from '@/components/stat-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { budgetStatus, monthRange, shiftMonth } from '@/lib/calc/finance';
import { todayBusinessDate } from '@/lib/dates';
import { formatKES } from '@/lib/money';
import { OWNER } from '@/lib/roles';
import { cn } from '@/lib/utils';
import { EXPENSE_CATEGORIES } from '@/lib/validation';
import { getExpenseBreakdown, listEntries } from '@/server/queries';
import { requireUser } from '@/server/session';

export const metadata = { title: 'Expenses · TastyMaziwa' };

const label = (c: string) => c.replace(/_/g, ' ').replace(/^\w/, (x) => x.toUpperCase());
const monthName = (m: string) =>
  new Intl.DateTimeFormat('en-KE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));

interface Row {
  category: string;
  spentCents: number;
  budgetCents: number | null;
}

/** Spending by category for one month, against each category's budget. */
export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await requireUser(OWNER);
  const today = todayBusinessDate();
  const { month, from, to } = monthRange((await searchParams).month, today);
  const db = await getDb();
  const [{ spent, budgets }, entries] = await Promise.all([
    getExpenseBreakdown(db, user.shopId, from, to),
    listEntries(db, user.shopId, { kinds: ['expense'], from, to, limit: 300 }),
  ]);
  const rows: Row[] = EXPENSE_CATEGORIES.map((c) => ({ category: c, spentCents: spent.get(c) ?? 0, budgetCents: budgets.get(c) ?? null }))
    .filter((r) => r.spentCents !== 0 || r.budgetCents != null)
    .sort((a, b) => b.spentCents - a.spentCents);
  const totalSpent = rows.reduce((n, r) => n + r.spentCents, 0);
  const totalBudget = rows.reduce((n, r) => n + (r.budgetCents ?? 0), 0);
  const over = rows.filter((r) => budgetStatus(r.spentCents, r.budgetCents).state === 'over');
  const isCurrent = month === today.slice(0, 7);

  const columns: Column<Row>[] = [
    { key: 'category', header: 'Category', primary: true, cell: (r) => label(r.category) },
    { key: 'spent', header: 'Spent', align: 'right', cell: (r) => formatKES(r.spentCents) },
    { key: 'budget', header: 'Budget', align: 'right', cell: (r) => (r.budgetCents != null ? formatKES(r.budgetCents) : '—') },
    {
      key: 'progress',
      header: 'Used',
      cell: (r) => {
        const s = budgetStatus(r.spentCents, r.budgetCents);
        if (s.state === 'none') return <span className="text-muted-foreground">No budget</span>;
        return (
          <span className="flex min-w-28 items-center gap-2">
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
              <span
                className={cn(
                  'block h-full rounded-full',
                  s.state === 'over' ? 'bg-red-600 dark:bg-red-400' : s.state === 'near' ? 'bg-amber-500' : 'bg-primary',
                )}
                style={{ width: `${Math.min(100, s.percent ?? 0)}%` }}
              />
            </span>
            <span
              className={cn(
                'w-12 text-right text-xs tabular-nums',
                s.state === 'over' && 'font-semibold text-red-600 dark:text-red-400',
              )}
            >
              {s.percent}%
            </span>
          </span>
        );
      },
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Expenses"
        description={`${monthName(month)}${isCurrent ? ' so far' : ''}`}
        actions={
          <>
            <BudgetsButton budgets={Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, budgets.get(c) ?? null]))} />
            <RecordDialog
              initial="expense"
              trigger={
                <Button className="h-11 gap-2">
                  <Plus className="size-4" aria-hidden /> Expense
                </Button>
              }
            />
          </>
        }
      />

      <nav aria-label="Choose a month" className="flex items-center gap-2">
        <Button asChild variant="outline" size="icon" className="size-11">
          <Link href={`/expenses?month=${shiftMonth(month, -1)}`} aria-label="Previous month">
            <ChevronLeft className="size-5" aria-hidden />
          </Link>
        </Button>
        <span className="min-w-36 text-center font-medium">{monthName(month)}</span>
        {isCurrent ? (
          <Button variant="outline" size="icon" className="size-11" disabled aria-label="Next month">
            <ChevronRight className="size-5" aria-hidden />
          </Button>
        ) : (
          <Button asChild variant="outline" size="icon" className="size-11">
            <Link href={`/expenses?month=${shiftMonth(month, 1)}`} aria-label="Next month">
              <ChevronRight className="size-5" aria-hidden />
            </Link>
          </Button>
        )}
      </nav>

      <section aria-label="Expense figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Spent" value={formatKES(totalSpent)} icon={Receipt} />
        <StatCard label="Budgeted" value={totalBudget ? formatKES(totalBudget) : '—'} icon={Target} />
        <StatCard
          label="Left to spend"
          value={totalBudget ? formatKES(totalBudget - totalSpent) : '—'}
          icon={Target}
          tone={totalBudget && totalSpent > totalBudget ? 'negative' : 'default'}
        />
        <StatCard label="Over budget" value={String(over.length)} icon={TriangleAlert} tone={over.length ? 'negative' : 'default'} />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>By category</CardTitle>
            <CardDescription>Set a monthly budget per category with Budgets.</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              label="Spending by category"
              columns={columns}
              rows={rows}
              rowKey={(r) => r.category}
              empty="No expenses this month."
              footer={{ category: 'Total', spent: formatKES(totalSpent), budget: totalBudget ? formatKES(totalBudget) : '' }}
            />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Entries</CardTitle>
          </CardHeader>
          <CardContent>
            <EntryList entries={entries} canReverse emptyText="No expenses this month." />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
