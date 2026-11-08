import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { currentUser } from '@/server/session';
import { SignupForm } from '../auth-forms';
import { AuthHeading } from '../auth-heading';

export const metadata = { title: 'Create your shop · TastyMaziwa' };

export default async function SignupPage() {
  if (await currentUser()) redirect('/');
  return (
    <>
      <AuthHeading title="Create your shop" subtitle="Your own private books. Free to start." />
      <Suspense>
        <SignupForm />
      </Suspense>
    </>
  );
}
