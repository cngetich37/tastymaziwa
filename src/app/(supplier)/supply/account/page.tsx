import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AccountPanel } from '@/components/account-panel';
import { SUPPLIER } from '@/lib/roles';
import { requireUser } from '@/server/session';

export const metadata = { title: 'Account · TastyMaziwa' };

export default async function SupplierAccountPage() {
  const user = await requireUser(SUPPLIER);
  return (
    <div className="grid gap-6">
      <Link href="/supply" className="-mb-3 flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> My deliveries
      </Link>
      <AccountPanel sessionUser={user} />
    </div>
  );
}
