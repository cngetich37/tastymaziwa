import { notFound } from 'next/navigation';
import { z } from 'zod';
import { StatementSheet } from '@/components/statement-sheet';
import { getDb } from '@/db';
import { resolveRange } from '@/lib/calc/reports';
import { todayBusinessDate } from '@/lib/dates';
import { OWNER } from '@/lib/roles';
import { getPeriodStatement, getShop, getSupplier } from '@/server/queries';
import { requireUser } from '@/server/session';

export const metadata = { title: 'Supplier statement · TastyMaziwa' };

export default async function SupplierStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const user = await requireUser(OWNER);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const db = await getDb();
  const supplier = await getSupplier(db, user.shopId, id.data);
  if (!supplier) notFound();
  const today = todayBusinessDate();
  const range = resolveRange(await searchParams, today);
  const [statement, shop] = await Promise.all([
    getPeriodStatement(db, user.shopId, { supplierId: supplier.id }, range.from, range.to),
    getShop(db, user.shopId),
  ]);
  return (
    <StatementSheet
      party="supplier"
      backHref={`/suppliers/${supplier.id}`}
      basePath={`/suppliers/${supplier.id}/statement`}
      name={supplier.name}
      phone={supplier.phone}
      shopName={shop?.name ?? 'TastyMaziwa'}
      range={range}
      today={today}
      statement={statement}
    />
  );
}
