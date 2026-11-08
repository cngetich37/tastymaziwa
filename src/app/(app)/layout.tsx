import { cookies } from 'next/headers';
import { SessionTimeout } from '@/components/session-timeout';
import { DesktopSidebar } from '@/components/shell/app-sidebar';
import { EntryDataProvider } from '@/components/shell/entry-data';
import { MobileHeader, MobileTabBar } from '@/components/shell/mobile-shell';
import { SIDEBAR_COOKIE } from '@/components/shell/nav-items';
import { getDb } from '@/db';
import { authConfig } from '@/server/auth/config';
import { getLastSalePriceCents, getShop, listCustomers, listSuppliers } from '@/server/queries';
import { requireUser } from '@/server/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const db = await getDb();
  const [shop, customers, suppliers, salePrice, cookieStore] = await Promise.all([
    getShop(db, user.shopId),
    listCustomers(db, user.shopId),
    listSuppliers(db, user.shopId),
    getLastSalePriceCents(db, user.shopId),
    cookies(),
  ]);
  const shopName = shop?.name ?? 'TastyMaziwa';
  const me = { name: user.name, role: user.role };

  // Only what the entry forms need goes to the browser.
  const entryData = {
    isOwner: user.role === 'owner',
    defaultSalePriceCents: salePrice,
    customers: customers.map((c) => ({ id: c.id, name: c.name, balanceCents: c.balanceCents })),
    suppliers: suppliers.map((s) => ({
      id: s.id,
      name: s.name,
      defaultPricePerLitreCents: s.defaultPricePerLitreCents,
    })),
  };

  return (
    <EntryDataProvider value={entryData}>
      <div className="flex min-h-dvh">
        <DesktopSidebar
          user={me}
          shopName={shopName}
          defaultCollapsed={cookieStore.get(SIDEBAR_COOKIE)?.value === 'collapsed'}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileHeader user={me} shopName={shopName} />
          {/* Bottom padding clears the phone tab bar and its raised Record button. */}
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-28 md:px-8 md:pt-8 md:pb-12">
            {children}
          </main>
        </div>
      </div>
      <MobileTabBar user={me} shopName={shopName} />
      <SessionTimeout idleSeconds={authConfig.sessionIdleSeconds} />
    </EntryDataProvider>
  );
}
