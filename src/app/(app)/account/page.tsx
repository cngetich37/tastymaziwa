import { AccountPanel } from '@/components/account-panel';
import { requireUser } from '@/server/session';

export const metadata = { title: 'Account · TastyMaziwa' };

export default async function AccountPage() {
  return <AccountPanel sessionUser={await requireUser()} />;
}
