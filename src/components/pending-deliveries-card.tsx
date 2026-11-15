import { Hourglass } from 'lucide-react';
import { PendingDeliveries, type PendingDelivery } from '@/components/delivery-review';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { BusinessDate } from '@/lib/dates';
import { formatLitres } from '@/lib/money';

/** The seller's to-do: supplier deliveries to check. Renders nothing when there are none. */
export function PendingDeliveriesCard({ deliveries, today }: { deliveries: PendingDelivery[]; today: BusinessDate }) {
  if (deliveries.length === 0) return null;
  const litres = deliveries.reduce((n, d) => n + d.volumeMl, 0);
  return (
    <Card role="region" className="border-amber-500/40 bg-amber-500/5" aria-label="Deliveries waiting for approval">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Hourglass className="size-5 text-amber-600 dark:text-amber-400" aria-hidden />
          Waiting for approval · {formatLitres(litres)}
        </CardTitle>
        <CardDescription>
          Check each against the milk that actually arrived. Approved milk goes into stock; a rejected one goes back to
          the supplier to record again.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <PendingDeliveries deliveries={deliveries} today={today} />
      </CardContent>
    </Card>
  );
}
