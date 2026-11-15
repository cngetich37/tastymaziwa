'use client';

import { useTransition } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { reviewDeliveryAction } from '@/app/actions';
import { FormDialog } from '@/components/form-dialog';
import { RejectDeliveryForm } from '@/components/forms/entry-forms';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { dayLabel, formatTime, type BusinessDate } from '@/lib/dates';
import { formatLitres } from '@/lib/money';

export interface PendingDelivery {
  id: string;
  supplierName: string;
  businessDate: BusinessDate;
  submittedAt: Date;
  volumeMl: number;
  note: string | null;
}

function ApproveButton({ delivery }: { delivery: PendingDelivery }) {
  const [pending, startTransition] = useTransition();
  const approve = () =>
    startTransition(async () => {
      const result = await reviewDeliveryAction({ submissionId: delivery.id, decision: 'approve' });
      toast(
        result.ok
          ? { title: `${formatLitres(delivery.volumeMl)} from ${delivery.supplierName} approved` }
          : { variant: 'destructive', title: 'Not approved', description: result.error },
      );
    });
  return (
    <Button className="h-11 flex-1 gap-2 sm:flex-none" onClick={approve} disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
      Approve
    </Button>
  );
}

/**
 * Deliveries suppliers recorded, waiting for the seller to check the litres
 * against what arrived. Approve adds them to stock; reject sends them back.
 */
export function PendingDeliveries({ deliveries, today }: { deliveries: PendingDelivery[]; today: BusinessDate }) {
  return (
    <ul className="divide-y">
      {deliveries.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              <span className="text-lg tabular-nums">{formatLitres(d.volumeMl)}</span> · {d.supplierName}
            </p>
            <p className="text-xs text-muted-foreground">
              {dayLabel(d.businessDate, today)}, {formatTime(new Date(d.submittedAt))}
              {d.note && <> · {d.note}</>}
            </p>
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            <ApproveButton delivery={d} />
            <FormDialog
              title={`Reject ${formatLitres(d.volumeMl)} from ${d.supplierName}?`}
              trigger={
                <Button variant="outline" className="h-11 flex-1 gap-2 sm:flex-none">
                  <X className="size-4" aria-hidden /> Reject
                </Button>
              }
            >
              {(close) => <RejectDeliveryForm submissionId={d.id} onDone={close} />}
            </FormDialog>
          </div>
        </li>
      ))}
    </ul>
  );
}
