import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, HandCoins, NotebookPen } from 'lucide-react';
import { z } from 'zod';
import { AddSubscriptionButton, EditCustomerButton } from '@/components/dialog-buttons';
import { PageHeader } from '@/components/page-header';
import { RecordDialog } from '@/components/shell/record-dialog';
import { StatementList } from '@/components/statement-list';
import { SubscriptionStatusButtons } from '@/components/subscription-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { formatShortDate } from '@/lib/dates';
import { formatKES, formatLitres } from '@/lib/money';
import { cn } from '@/lib/utils';
import { getCustomer, getOutstandingCredit, getShop, getStatement } from '@/server/queries';
import { requireUser } from '@/server/session';

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(['owner']);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const db = await getDb();
  const customer = await getCustomer(db, user.shopId, id.data);
  if (!customer) notFound();
  const [statement, outstanding, shop] = await Promise.all([
    getStatement(db, user.shopId, { customerId: customer.id }),
    getOutstandingCredit(db, user.shopId),
    getShop(db, user.shopId),
  ]);
  const unpaid = outstanding.filter((s) => s.customerId === customer.id);
  const sub = customer.subscription;
  const self = [{ id: customer.id, name: customer.name, balanceCents: customer.balanceCents }];

  return (
    <div className="grid grid-cols-1 gap-6">
      <Link href="/customers" className="-mb-3 flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Customers
      </Link>
      <PageHeader
        title={customer.name}
        description={[customer.phone, customer.address].filter(Boolean).join(' · ') || 'No contact details'}
        actions={
          <>
            <RecordDialog
              initial="payment"
              defaults={{ customerId: customer.id }}
              trigger={
                <Button className="h-11 gap-2">
                  <HandCoins className="size-4" aria-hidden /> Receive payment
                </Button>
              }
            />
            <RecordDialog
              initial="sale"
              defaults={{ customerId: customer.id }}
              trigger={
                <Button variant="outline" className="h-11 gap-2">
                  <NotebookPen className="size-4" aria-hidden /> Credit sale
                </Button>
              }
            />
            <EditCustomerButton
              customer={{ id: customer.id, name: customer.name, phone: customer.phone, address: customer.address }}
            />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardDescription>{customer.balanceCents >= 0 ? 'Owes you' : 'In credit'}</CardDescription>
              <CardTitle
                className={cn(
                  'text-3xl tabular-nums',
                  unpaid.some((s) => s.daysOverdue > 0) && 'text-red-600 dark:text-red-400',
                )}
              >
                {formatKES(Math.abs(customer.balanceCents))}
              </CardTitle>
            </CardHeader>
            {unpaid.length > 0 && (
              <CardContent>
                <p className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Unpaid sales</p>
                <ul className="divide-y text-sm">
                  {unpaid.map((s) => (
                    <li key={s.id} className="flex items-start justify-between gap-3 py-2">
                      <span>
                        {formatLitres(s.volumeMl)} on {formatShortDate(s.businessDate)}
                        <span
                          className={cn(
                            'block text-xs',
                            s.daysOverdue > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground',
                          )}
                        >
                          {s.daysOverdue > 0
                            ? `${s.daysOverdue} day${s.daysOverdue === 1 ? '' : 's'} overdue`
                            : s.dueDate
                              ? `Due ${formatShortDate(s.dueDate)}`
                              : 'No due date'}
                        </span>
                      </span>
                      <span className="font-mono tabular-nums">{formatKES(s.outstandingCents)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Daily subscription</CardTitle>
              <CardDescription>Milk delivered every day and added to their account.</CardDescription>
            </CardHeader>
            <CardContent>
              {sub ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant={sub.status === 'active' ? 'default' : 'secondary'}>
                    {formatLitres(sub.dailyMl)}/day @ {formatKES(sub.pricePerLitreCents)}
                    {sub.status === 'paused' && ' · paused'}
                  </Badge>
                  <SubscriptionStatusButtons subscriptionId={sub.id} status={sub.status} />
                </div>
              ) : (
                <AddSubscriptionButton
                  customers={self}
                  customerId={customer.id}
                  defaultPriceCents={shop?.salePricePerLitreCents ?? null}
                />
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Statement</CardTitle>
            <CardDescription>Purchases and payments, newest first. Payments clear the oldest sales first.</CardDescription>
          </CardHeader>
          <CardContent>
            <StatementList lines={statement} balanceLabel="Owes" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
