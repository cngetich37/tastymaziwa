import { SessionTimeout } from '@/components/session-timeout';
import { SupplierHeader } from '@/components/shell/supplier-header';
import { getDb } from '@/db';
import { SUPPLIER } from '@/lib/roles';
import { authConfig } from '@/server/auth/config';
import { getShop } from '@/server/queries';
import { requireUser } from '@/server/session';

/**
 * A supplier's (milkman's) own pages. Deliberately separate from the shop's
 * layout, which loads customers, prices and payables: none of that is theirs.
 */
export default async function SupplierLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser(SUPPLIER);
  const shop = await getShop(await getDb(), user.shopId);
  return (
    <div className="min-h-dvh">
      <SupplierHeader name={user.name} shopName={shop?.name ?? 'TastyMaziwa'} />
      <main className="mx-auto w-full max-w-3xl px-4 pt-5 pb-12 md:pt-8">{children}</main>
      <SessionTimeout idleSeconds={authConfig.sessionIdleSeconds} />
    </div>
  );
}
