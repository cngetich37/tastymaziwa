import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Plus, Wallet } from 'lucide-react';
import { z } from 'zod';
import { EditSupplierButton } from '@/components/dialog-buttons';
import { PageHeader } from '@/components/page-header';
import { RecordDialog } from '@/components/shell/record-dialog';
import { StatementList } from '@/components/statement-list';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { formatKES } from '@/lib/money';
import { getStatement, getSupplier } from '@/server/queries';
import { requireUser } from '@/server/session';

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(['owner']);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const db = await getDb();
  const supplier = await getSupplier(db, user.shopId, id.data);
  if (!supplier) notFound();
  const statement = await getStatement(db, user.shopId, { supplierId: supplier.id });

  return (
    <div className="grid grid-cols-1 gap-6">
      <Link href="/suppliers" className="-mb-3 flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Suppliers
      </Link>
      <PageHeader
        title={supplier.name}
        description={supplier.phone ?? 'No phone number'}
        actions={
          <>
            <RecordDialog
              initial="supplier"
              defaults={{ supplierId: supplier.id }}
              trigger={
                <Button className="h-11 gap-2">
                  <Wallet className="size-4" aria-hidden /> Pay supplier
                </Button>
              }
            />
            <RecordDialog
              initial="delivery"
              defaults={{ supplierId: supplier.id }}
              trigger={
                <Button variant="outline" className="h-11 gap-2">
                  <Plus className="size-4" aria-hidden /> Delivery
                </Button>
              }
            />
            <EditSupplierButton
              supplier={{
                id: supplier.id,
                name: supplier.name,
                phone: supplier.phone,
                defaultPricePerLitreCents: supplier.defaultPricePerLitreCents,
              }}
            />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardDescription>You owe them</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{formatKES(supplier.payableCents)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Agreed price per litre</CardDescription>
              <CardTitle className="text-3xl tabular-nums">
                {supplier.defaultPricePerLitreCents != null ? formatKES(supplier.defaultPricePerLitreCents) : 'Not set'}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {supplier.defaultPricePerLitreCents != null
                ? 'Attendants record deliveries at this price. Change it with Edit.'
                : 'Attendants can’t record deliveries from this supplier until you set a price with Edit.'}
            </CardContent>
          </Card>
        </div>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Statement</CardTitle>
            <CardDescription>Deliveries and payments, newest first.</CardDescription>
          </CardHeader>
          <CardContent>
            <StatementList lines={statement} balanceLabel="Owed" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
