import { AddSupplierButton, AddUserButton } from '@/components/dialog-buttons';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { formatKES } from '@/lib/money';
import { listSuppliers } from '@/server/queries';
import { requireUser } from '@/server/session';
import { listUsers } from '@/server/users';

export default async function SettingsPage() {
  await requireUser(['owner']);
  const db = await getDb();
  const [suppliers, users] = await Promise.all([listSuppliers(db), listUsers(db)]);

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
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
              <CardDescription>People who can sign in.</CardDescription>
            </div>
            <AddUserButton />
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {users.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium">{u.name}</p>
                    <p className="text-xs text-muted-foreground">@{u.username}</p>
                  </div>
                  <div className="flex gap-2">
                    {!u.active && <Badge variant="secondary">Disabled</Badge>}
                    <Badge variant={u.role === 'owner' ? 'default' : 'outline'} className="capitalize">
                      {u.role}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
