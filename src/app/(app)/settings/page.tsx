import { AddSupplierButton, InviteStaffButton } from '@/components/dialog-buttons';
import { ShopNameForm, TeamMemberMenu } from '@/components/forms/account-forms';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { formatKES } from '@/lib/money';
import { getShop, listSuppliers } from '@/server/queries';
import { requireUser } from '@/server/session';
import { listUsers } from '@/server/users';

export const metadata = { title: 'Settings · TastyMaziwa' };

export default async function SettingsPage() {
  const me = await requireUser(['owner']);
  const db = await getDb();
  const [shop, suppliers, users] = await Promise.all([
    getShop(db, me.shopId),
    listSuppliers(db, me.shopId),
    listUsers(db, me.shopId),
  ]);

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Shop</CardTitle>
          <CardDescription>Shown in the header and in emails to your team.</CardDescription>
        </CardHeader>
        <CardContent>
          <ShopNameForm name={shop?.name ?? ''} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Suppliers</CardTitle>
              <CardDescription>Who you buy milk from, and what you owe them.</CardDescription>
            </div>
            <AddSupplierButton />
          </CardHeader>
          <CardContent>
            {suppliers.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No suppliers yet.</p>
            ) : (
              <ul className="divide-y">
                {suppliers.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                    <div>
                      <p className="font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {[s.phone, s.defaultPricePerLitreCents != null && `${formatKES(s.defaultPricePerLitreCents)}/L`]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm font-medium tabular-nums">{formatKES(s.payableCents)}</p>
                      <p className="text-xs text-muted-foreground">owed</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
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
