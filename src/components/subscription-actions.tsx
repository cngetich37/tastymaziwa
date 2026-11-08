'use client';

import { useTransition } from 'react';
import { Loader2, Truck } from 'lucide-react';
import { billSubscriptionsAction, setSubscriptionStatusAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { formatKES, formatLitres } from '@/lib/money';

export function BillSubscriptionsButton() {
  const [pending, startTransition] = useTransition();
  const run = () =>
    startTransition(async () => {
      const result = await billSubscriptionsAction({});
      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Billing failed', description: result.error });
        return;
      }
      const { billed, active, volumeMl, amountCents } = result.data;
      toast({
        title: billed > 0 ? `Billed ${billed} subscription${billed === 1 ? '' : 's'}` : 'Already billed today',
        description:
          billed > 0
            ? `${formatLitres(volumeMl)} · ${formatKES(amountCents)} added to customer accounts`
            : `All ${active} active subscriptions were already billed for today.`,
      });
    });

  return (
    <Button variant="outline" onClick={run} disabled={pending} className="h-11 gap-2">
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" aria-hidden />}
      Bill today&apos;s subscriptions
    </Button>
  );
}

export function SubscriptionStatusButtons({
  subscriptionId,
  status,
}: {
  subscriptionId: string;
  status: string;
}) {
  const [pending, startTransition] = useTransition();
  const set = (next: 'active' | 'paused' | 'cancelled') =>
    startTransition(async () => {
      if (next === 'cancelled' && !confirm('Cancel this subscription? This cannot be undone.')) return;
      const result = await setSubscriptionStatusAction({ subscriptionId, status: next });
      toast(
        result.ok
          ? { title: `Subscription ${next === 'active' ? 'resumed' : next}` }
          : { variant: 'destructive', title: 'Not changed', description: result.error },
      );
    });

  return (
    <div className="flex gap-1">
      {status === 'active' ? (
        <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={pending} onClick={() => set('paused')}>
          Pause
        </Button>
      ) : (
        <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={pending} onClick={() => set('active')}>
          Resume
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="h-8 px-2 text-xs text-destructive"
        disabled={pending}
        onClick={() => set('cancelled')}
      >
        Cancel
      </Button>
    </div>
  );
}
