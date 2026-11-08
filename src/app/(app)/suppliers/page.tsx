import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { AddSupplierButton } from '@/components/dialog-buttons';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { getDb } from '@/db';
import { formatKES } from '@/lib/money';
import { listSuppliers } from '@/server/queries';
import { requireUser } from '@/server/session';

export const metadata = { title: 'Suppliers · TastyMaziwa' };

export default async function SuppliersPage() {
  const user = await requireUser(['owner']);
  const suppliers = await listSuppliers(await getDb(), user.shopId);
  const totalOwed = suppliers.reduce((sum, s) => sum + Math.max(0, s.payableCents), 0);

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Suppliers"
        description={
          <>
            You owe suppliers <span className="font-semibold text-foreground">{formatKES(totalOwed)}</span>
          </>
        }
        actions={<AddSupplierButton />}
      />
      <Card>
        <CardContent className="py-2">
          {suppliers.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No suppliers yet. Add the milkman you buy from.
            </p>
          ) : (
            <ul className="divide-y">
              {suppliers.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/suppliers/${s.id}`}
                    className="-mx-2 flex min-h-16 items-center gap-3 rounded-lg px-2 py-3 hover:bg-muted"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{s.name}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {s.phone && <span>{s.phone}</span>}
                        {s.defaultPricePerLitreCents != null ? (
                          <span>{formatKES(s.defaultPricePerLitreCents)}/L</span>
                        ) : (
                          <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
                            No price set
                          </Badge>
                        )}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm font-medium tabular-nums">{formatKES(s.payableCents)}</p>
                      <p className="text-xs text-muted-foreground">owed</p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
