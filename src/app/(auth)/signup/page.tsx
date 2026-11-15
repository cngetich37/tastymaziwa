import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { demoConfig } from '@/server/demo/demo';
import { isDemoShop } from '@/server/demo/guard';
import { keptAnything, summarizeDemoKeep, type DemoKeepSummary } from '@/server/demo/keep';
import { currentUser } from '@/server/session';
import { SignupForm } from '../auth-forms';
import { AuthHeading } from '../auth-heading';
import { TryDemo } from '../try-demo';

export const metadata = { title: 'Create your shop · TastyMaziwa' };

/** "2 customers, 1 product and your selling price" */
function describeKeep(s: DemoKeepSummary): string {
  const count = (n: number, one: string, many = `${one}s`) => (n ? [`${n} ${n === 1 ? one : many}`] : []);
  const parts = [
    ...count(s.customers, 'customer'),
    ...count(s.subscriptions, 'subscription'),
    ...count(s.suppliers, 'supplier'),
    ...count(s.products, 'product'),
    ...count(s.staff, 'staff member', 'staff'),
    ...(s.budgets ? ['your budgets'] : []),
    ...(s.salePrice ? ['your selling price'] : []),
  ];
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] ?? '';
}

export default async function SignupPage() {
  const user = await currentUser();
  // Signed in to a demo shop: sign up from here and optionally keep what was added.
  let fromDemo: { keep: string | null } | null = null;
  if (user) {
    const db = await getDb();
    if (!(await isDemoShop(db, user.shopId))) redirect('/');
    const summary = await summarizeDemoKeep(db, user.shopId);
    fromDemo = { keep: keptAnything(summary) ? describeKeep(summary) : null };
  }
  return (
    <>
      <AuthHeading
        title="Create your shop"
        subtitle={fromDemo ? 'Your real shop, with empty books. The demo stays open until you finish.' : 'Your own private books. Free to start.'}
      />
      <Suspense>
        <SignupForm fromDemo={fromDemo} />
      </Suspense>
      {!fromDemo && demoConfig.enabled && <TryDemo />}
    </>
  );
}
