import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@/db';
import { peekLinkToken } from '@/server/auth/tokens';
import { ResetPasswordForm } from '../auth-forms';
import { AuthHeading } from '../auth-heading';

export const metadata: Metadata = {
  title: 'Choose a password · TastyMaziwa',
  // The token is in the URL: never leak it to other sites via the Referer header.
  referrer: 'no-referrer',
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const valid = token ? await peekLinkToken(await getDb(), 'password_reset', token) : null;

  if (!token || !valid) {
    return (
      <>
        <AuthHeading title="This link has expired" subtitle="Reset links work once and only for a limited time." />
        <Link
          href="/forgot-password"
          className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary text-base font-medium text-primary-foreground"
        >
          Send me a new link
        </Link>
      </>
    );
  }

  const isInvite = (valid.data as { invite?: boolean } | null)?.invite === true;
  return (
    <>
      <AuthHeading
        title={isInvite ? 'Welcome! Set your password' : 'Choose a new password'}
        subtitle={`For ${valid.email}`}
      />
      <ResetPasswordForm token={token} />
    </>
  );
}
