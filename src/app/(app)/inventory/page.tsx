import Link from 'next/link';
import { AlertTriangle, Boxes, Droplet, Droplets, PackagePlus, Wallet } from 'lucide-react';
import { DataTable, type Column } from '@/components/data-table';
import { AddProductButton, ArchiveProductButton, EditProductButton } from '@/components/dialog-buttons';
import { PageHeader } from '@/components/page-header';
import { RecordDialog } from '@/components/shell/record-dialog';
import { StatCard } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { formatKES, formatQuantity, lineTotalCents } from '@/lib/money';
import { OWNER } from '@/lib/roles';
import { getStockLevels, type StockLevel } from '@/server/queries';
import { requireUser } from '@/server/session';

export const metadata = { title: 'Stock & products · TastyMaziwa' };

/** Days the stock lasts at last week's pace; null if nothing sold. */
const daysLeft = (s: StockLevel) => (s.sold7d > 0 ? Math.floor(s.onHand / (s.sold7d / 7)) : null);

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await requireUser(OWNER);
  const showArchived = (await searchParams).show === 'archived';
  const levels = await getStockLevels(await getDb(), user.shopId, { includeArchived: showArchived });
  const products = levels.filter((l) => l.productId != null);
  const milk = levels.find((l) => l.productId == null)!;
  const low = levels.filter((l) => l.low);
  const stockValue = products.reduce(
    (n, p) => n + (p.costPriceCents != null && p.onHand > 0 ? lineTotalCents(p.onHand, p.costPriceCents) : 0),
    0,
  );

  const columns: Column<StockLevel>[] = [
    {
      key: 'name',
      header: 'Product',
      primary: true,
      cell: (s) => (
        <span className="flex flex-wrap items-center gap-2">
          {s.name}
          {s.archived && <Badge variant="secondary">Not sold</Badge>}
          {s.low && !s.archived && (
            <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
              Low
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: 'onHand',
      header: 'In stock',
      align: 'right',
      cell: (s) => (
        <span className={s.onHand < 0 ? 'text-red-600 dark:text-red-400' : undefined}>{formatQuantity(s.onHand, s.unit)}</span>
      ),
    },
    {
      key: 'sold7d',
      header: 'Sold, 7 days',
      align: 'right',
      cell: (s) => formatQuantity(s.sold7d, s.unit),
    },
    {
      key: 'days',
      header: 'Lasts',
      align: 'right',
      cell: (s) => {
        const d = daysLeft(s);
        return d == null ? '—' : d <= 0 ? 'Out' : `${d} day${d === 1 ? '' : 's'}`;
      },
    },
    {
      key: 'price',
      header: 'Sells at',
      align: 'right',
      cell: (s) => (s.salePriceCents != null ? formatKES(s.salePriceCents) : <span className="text-muted-foreground">Not set</span>),
    },
    {
      key: 'cost',
      header: 'Buys at',
      align: 'right',
      hideOnMobile: true,
      cell: (s) => (s.costPriceCents != null ? formatKES(s.costPriceCents) : '—'),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (s) =>
        s.productId ? (
          <span className="inline-flex">
            <EditProductButton
              product={{
                id: s.productId,
                name: s.name,
                unit: s.unit,
                salePriceCents: s.salePriceCents,
                costPriceCents: s.costPriceCents,
                reorderLevel: s.reorderLevel,
              }}
            />
            <ArchiveProductButton id={s.productId} name={s.name} archived={s.archived} />
          </span>
        ) : (
          <Link href="/settings" className="text-xs text-primary underline-offset-2 hover:underline">
            Price in Settings
          </Link>
        ),
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Stock & products"
        description="What is on the shelf, how fast it sells, and what it is worth."
        actions={
          <>
            <RecordDialog
              initial="delivery"
              trigger={
                <Button variant="outline" className="h-11 gap-2">
                  <PackagePlus className="size-4" aria-hidden /> Stock in
                </Button>
              }
            />
            <RecordDialog
              initial="spoilage"
              trigger={
                <Button variant="outline" className="h-11 gap-2">
                  <Droplets className="size-4" aria-hidden /> Write off
                </Button>
              }
            />
            <AddProductButton />
          </>
        }
      />

      <section aria-label="Stock figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Milk in stock"
          value={formatQuantity(milk.onHand)}
          icon={Droplet}
          tone={milk.onHand < 0 ? 'warning' : 'default'}
          detail={daysLeft(milk) != null ? `About ${Math.max(0, daysLeft(milk)!)} days at this week's pace` : undefined}
        />
        <StatCard label="Products" value={String(products.filter((p) => !p.archived).length)} icon={Boxes} />
        <StatCard
          label="Low on stock"
          value={String(low.length)}
          icon={AlertTriangle}
          tone={low.length ? 'warning' : 'default'}
        />
        <StatCard label="Stock value" value={formatKES(stockValue)} icon={Wallet} detail="Products at buying price" />
      </section>

      {low.length > 0 && (
        <Card role="region" aria-label="Low stock" className="border-amber-500/40 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber-600 dark:text-amber-400" aria-hidden /> Reorder soon
            </CardTitle>
            <CardDescription>
              {low.map((l) => `${l.name} (${formatQuantity(l.onHand, l.unit)})`).join(' · ')}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>All stock</CardTitle>
            <CardDescription>Bought − sold − written off, from every entry.</CardDescription>
          </div>
          <Link
            href={showArchived ? '/inventory' : '/inventory?show=archived'}
            className="flex h-11 items-center text-sm text-primary underline-offset-2 hover:underline"
          >
            {showArchived ? 'Hide products not sold' : 'Show products not sold'}
          </Link>
        </CardHeader>
        <CardContent>
          <DataTable label="Stock levels" columns={columns} rows={levels} rowKey={(s) => s.productId ?? 'milk'} />
        </CardContent>
      </Card>
    </div>
  );
}
