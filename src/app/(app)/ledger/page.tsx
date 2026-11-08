import Link from 'next/link';
import { Plus } from 'lucide-react';
import { EntryList } from '@/components/entry-list';
import { PageHeader } from '@/components/page-header';
import { RecordDialog } from '@/components/shell/record-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getDb } from '@/db';
import { listEntries } from '@/server/queries';
import { requireUser } from '@/server/session';

const PAGE_SIZE = 50;

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await requireUser(['owner']);
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const db = await getDb();
  const entries = await listEntries(db, user.shopId, { limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE });
  const hasMore = entries.length > PAGE_SIZE;

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Ledger"
        description="Every sale, delivery, payment and write-off, newest first."
        actions={
          <RecordDialog
            trigger={
              <Button className="h-11 gap-2">
                <Plus className="size-4" aria-hidden /> New entry
              </Button>
            }
          />
        }
      />
      <Card>
        <CardContent className="pt-6">
          <EntryList entries={entries.slice(0, PAGE_SIZE)} canReverse />
          <div className="mt-4 flex justify-between">
            {page > 1 ? (
              <Button asChild variant="outline" className="h-11">
                <Link href={`/ledger?page=${page - 1}`}>Newer</Link>
              </Button>
            ) : (
              <span />
            )}
            {hasMore && (
              <Button asChild variant="outline" className="h-11">
                <Link href={`/ledger?page=${page + 1}`}>Older</Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
