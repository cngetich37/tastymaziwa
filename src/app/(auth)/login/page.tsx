import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { currentUser } from '@/server/session';
import { LoginForm } from '../auth-forms';
import { AuthHeading } from '../auth-heading';
import { TryDemo } from '../try-demo';
import { demoConfig } from '@/server/demo/demo';

export const metadata = { title: 'Sign in · TastyMaziwa' };

export default async function LoginPage() {
  if (await currentUser()) redirect('/');
  return (
    <>
      <AuthHeading title="Sign in" subtitle="Record today's milk, credit and profit." />
      <Suspense>
        <LoginForm />
      </Suspense>
      {demoConfig.enabled && <TryDemo />}
    </>
  );
}
