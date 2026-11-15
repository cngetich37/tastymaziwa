import { notFound } from 'next/navigation';
import { z } from 'zod';
import { StatementSheet } from '@/components/statement-sheet';
import { getDb } from '@/db';
import { resolveRange } from '@/lib/calc/reports';
import { todayBusinessDate } from '@/lib/dates';
import { OWNER } from '@/lib/roles';
import { getCustomer, getPeriodStatement, getShop } from '@/server/queries';
import { requireUser } from '@/server/session';

export const metadata = { title: 'Customer statement · TastyMaziwa' };

export default async function CustomerStatementPage({
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
  const customer = await getCustomer(db, user.shopId, id.data);
  if (!customer) notFound();
  const today = todayBusinessDate();
  const range = resolveRange(await searchParams, today);
  const [statement, shop] = await Promise.all([
    getPeriodStatement(db, user.shopId, { customerId: customer.id }, range.from, range.to),
    getShop(db, user.shopId),
  ]);
  return (
    <StatementSheet
      party="customer"
      backHref={`/customers/${customer.id}`}
      basePath={`/customers/${customer.id}/statement`}
      name={customer.name}
      phone={customer.phone}
      shopName={shop?.name ?? 'TastyMaziwa'}
      range={range}
      today={today}
      statement={statement}
    />
  );
}
