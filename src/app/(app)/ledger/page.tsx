import Link from 'next/link';
import { EntryList } from '@/components/entry-list';
import { LedgerForms } from '@/components/ledger-forms';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { getLastSalePriceCents, listCustomers, listEntries, listSuppliers } from '@/server/queries';
import { requireUser } from '@/server/session';

const PAGE_SIZE = 50;

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await requireUser();
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const db = await getDb();
  const [entries, customers, suppliers, salePrice] = await Promise.all([
    listEntries(db, { limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE }),
    listCustomers(db),
    listSuppliers(db),
    getLastSalePriceCents(db),
  ]);
  const hasMore = entries.length > PAGE_SIZE;

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="lg:col-span-2">
        <h1 className="mb-4 text-2xl font-bold tracking-tight">Ledger</h1>
        <Card>
          <CardContent className="pt-6">
            <LedgerForms
              isOwner={user.role === 'owner'}
              customers={customers}
              suppliers={suppliers}
              defaultSalePriceCents={salePrice}
            />
          </CardContent>
        </Card>
      </div>
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          <EntryList entries={entries.slice(0, PAGE_SIZE)} canReverse={user.role === 'owner'} />
          <div className="mt-4 flex justify-between">
            {page > 1 ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/ledger?page=${page - 1}`}>Newer</Link>
              </Button>
            ) : (
              <span />
            )}
            {hasMore && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/ledger?page=${page + 1}`}>Older</Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
