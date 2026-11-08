import { ChangeEmailForm, ChangePasswordForm, ProfileForm } from '@/components/forms/account-forms';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { requireUser } from '@/server/session';
import { getUser } from '@/server/users';

export const metadata = { title: 'Account · TastyMaziwa' };

export default async function AccountPage() {
  const sessionUser = await requireUser();
  const user = await getUser(await getDb(), sessionUser.shopId, sessionUser.id);
  if (!user) return null;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Your account</h1>
        <p className="text-sm capitalize text-muted-foreground">{user.role}</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <ProfileForm name={user.name} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Email</CardTitle>
            <CardDescription>Used to sign in, reset your password and receive codes.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChangeEmailForm currentEmail={user.email} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{user.hasPassword ? 'Password' : 'Set a password'}</CardTitle>
            <CardDescription>
              {user.hasPassword
                ? 'Changing it signs you out on every other device.'
                : 'You sign in with email codes. Add a password if you prefer.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm hasPassword={user.hasPassword} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
