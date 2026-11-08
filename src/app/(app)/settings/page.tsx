import Link from 'next/link';
import { InviteStaffButton } from '@/components/dialog-buttons';
import { SalePriceForm } from '@/components/forms/entry-forms';
import { PageHeader } from '@/components/page-header';
import { ShopNameForm, TeamMemberMenu } from '@/components/forms/account-forms';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { getShop } from '@/server/queries';
import { requireUser } from '@/server/session';
import { listUsers } from '@/server/users';

export const metadata = { title: 'Settings · TastyMaziwa' };

export default async function SettingsPage() {
  const me = await requireUser(['owner']);
  const db = await getDb();
  const [shop, users] = await Promise.all([getShop(db, me.shopId), listUsers(db, me.shopId)]);

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title="Settings" description="Your shop, prices and team." />

      <Card>
        <CardHeader>
          <CardTitle>Shop</CardTitle>
          <CardDescription>Shown in the menu and in emails to your team.</CardDescription>
        </CardHeader>
        <CardContent>
          <ShopNameForm name={shop?.name ?? ''} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Selling price</CardTitle>
            <CardDescription>
              Attendants sell at this price and can&apos;t change it. Buying prices are set per supplier on the{' '}
              <Link href="/suppliers" className="underline underline-offset-2">
                Suppliers
              </Link>{' '}
              page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SalePriceForm priceCents={shop?.salePricePerLitreCents ?? null} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Team</CardTitle>
              <CardDescription>People who can sign in to this shop.</CardDescription>
            </div>
            <InviteStaffButton />
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {users.map((u) => {
                const invited = !u.hasPassword && !u.emailVerifiedAt;
                return (
                  <li key={u.id} className="flex items-start gap-3 py-3">
                    {/* Badges sit under the name so the row never overflows on a phone. */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {u.name}
                        {u.id === me.id && <span className="text-muted-foreground"> (you)</span>}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        <Badge variant={u.role === 'owner' ? 'default' : 'outline'} className="capitalize">
                          {u.role}
                        </Badge>
                        {u.active && invited && <Badge variant="outline">Invited</Badge>}
                        {!u.active && <Badge variant="secondary">Deactivated</Badge>}
                      </div>
                    </div>
                    {u.id !== me.id && (
                      <div className="shrink-0">
                        <TeamMemberMenu member={{ id: u.id, name: u.name, role: u.role, active: u.active, invited }} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
