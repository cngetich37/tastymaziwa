import { Wallet } from 'lucide-react';
import { PayRun } from '@/components/finance-panels';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { formatKES } from '@/lib/money';
import { OWNER } from '@/lib/roles';
import { listSuppliers } from '@/server/queries';
import { requireUser } from '@/server/session';

export const metadata = { title: 'Pay suppliers · TastyMaziwa' };

/** The weekly (or monthly) settlement: everyone you owe, paid in one go. */
export default async function PaySuppliersPage() {
  const user = await requireUser(OWNER);
  const suppliers = await listSuppliers(await getDb(), user.shopId);
  const owed = suppliers.filter((s) => s.payableCents > 0).sort((a, b) => b.payableCents - a.payableCents);
  const total = owed.reduce((n, s) => n + s.payableCents, 0);

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title="Pay suppliers" description="Settle what you owe your milkmen in one payment run." />
      <section aria-label="Payables" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="You owe" value={formatKES(total)} icon={Wallet} tone={total > 0 ? 'warning' : 'default'} />
        <StatCard label="Suppliers owed" value={String(owed.length)} icon={Wallet} />
      </section>
      <Card>
        <CardHeader>
          <CardTitle>Payment run</CardTitle>
          <CardDescription>Each payment is recorded against the supplier and shows on their statement.</CardDescription>
        </CardHeader>
        <CardContent>
          <PayRun suppliers={owed.map((s) => ({ id: s.id, name: s.name, payableCents: s.payableCents }))} />
        </CardContent>
      </Card>
    </div>
  );
}
