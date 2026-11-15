'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { signIn } from 'next-auth/react';
import { Store } from 'lucide-react';
import { startDemoAction } from '@/app/auth-actions';
import { Button } from '@/components/ui/button';

/** One tap into a private sample shop: no email, no password. */
export function TryDemo() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const start = () =>
    startTransition(async () => {
      setError(null);
      const result = await startDemoAction({});
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const res = await signIn('demo', { token: result.data.token, redirect: false });
      if (res?.error) {
        setError('The demo could not start. Please try again.');
        return;
      }
      router.push('/');
      router.refresh();
    });

  return (
    <section aria-labelledby="try-demo" className="grid gap-2 rounded-lg border border-dashed p-4">
      <h2 id="try-demo" className="text-sm font-semibold">
        Just looking?
      </h2>
      <p className="text-sm text-muted-foreground">
        Open a sample milk shop with six weeks of sales, credit, deliveries and staff. Try everything, as the owner,
        the seller or the milkman. It&apos;s yours alone and is deleted after a day.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <Button type="button" variant="outline" className="h-11" onClick={start} disabled={pending}>
        <Store aria-hidden />
        {pending ? 'Setting up your demo shop…' : 'Try the demo shop'}
      </Button>
    </section>
  );
}
