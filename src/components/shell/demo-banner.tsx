'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { demoSwitchRoleAction } from '@/app/actions';
import type { Role } from '@/db/schema';
import { ROLE_LABELS, homeFor } from '@/lib/roles';
import { cn } from '@/lib/utils';

const ROLES: { role: Role; hint: string }[] = [
  { role: 'owner', hint: 'everything' },
  { role: 'attendant', hint: 'the counter' },
  { role: 'supplier', hint: 'the milkman' },
];

/**
 * Shown on every page of a demo shop: what this is, and one tap to see the
 * shop as each role. Switching signs in as that role's demo login.
 */
export function DemoBanner({ role, hoursLeft }: { role: Role; hoursLeft: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const switchTo = (next: Role) =>
    startTransition(async () => {
      setError(null);
      const result = await demoSwitchRoleAction({ role: next });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const res = await signIn('demo', { token: result.data.token, redirect: false });
      if (res?.error) {
        setError('Could not switch. Please try again.');
        return;
      }
      router.push(homeFor(next));
      router.refresh();
    });

  return (
    <aside
      aria-label="Demo shop"
      className="mb-5 grid gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm print:hidden"
    >
      <p>
        <strong>Demo shop.</strong> Sample data that only you can see. Try anything; it&apos;s deleted in about{' '}
        {hoursLeft} {hoursLeft === 1 ? 'hour' : 'hours'}.
      </p>
      <div role="group" aria-label="View the shop as" className="grid grid-cols-3 gap-2">
        {ROLES.map(({ role: r, hint }) => (
          <button
            key={r}
            type="button"
            disabled={pending || r === role}
            aria-pressed={r === role}
            onClick={() => switchTo(r)}
            className={cn(
              'flex h-11 flex-col items-center justify-center rounded-md border px-1 leading-tight',
              r === role
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-background hover:bg-accent disabled:opacity-60',
            )}
          >
            <span className="font-medium">{ROLE_LABELS[r]}</span>
            <span className={cn('text-xs', r === role ? 'opacity-90' : 'text-muted-foreground')}>{hint}</span>
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <Link href="/signup" className="justify-self-start font-medium text-primary underline-offset-2 hover:underline">
        Ready? Create your own shop →
      </Link>
    </aside>
  );
}
