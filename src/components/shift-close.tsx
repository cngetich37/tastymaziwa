'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, Loader2, TriangleAlert } from 'lucide-react';
import { reviewShiftCloseAction } from '@/app/actions';
import { ShiftCloseForm, type CloseResult } from '@/components/forms/entry-forms';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { TOLERANCE } from '@/lib/calc/close';
import { formatKESSigned, formatQuantity } from '@/lib/money';
import { cn } from '@/lib/utils';

/** "+Ksh 50 over" / "−Ksh 200 short" / "Exact", coloured by how far off it is. */
export function Variance({ value, kind }: { value: number; kind: 'cash' | 'mpesa' | 'milk' }) {
  const tolerance = kind === 'cash' ? TOLERANCE.cashCents : kind === 'mpesa' ? TOLERANCE.mpesaCents : TOLERANCE.milkMl;
  const text =
    value === 0
      ? 'Exact'
      : `${kind === 'milk' ? `${value > 0 ? '+' : '−'}${formatQuantity(Math.abs(value))}` : formatKESSigned(value)} ${value > 0 ? 'over' : 'short'}`;
  return (
    <span
      className={cn(
        'font-semibold tabular-nums',
        value === 0 && 'text-green-700 dark:text-green-400',
        value !== 0 && Math.abs(value) <= tolerance && 'text-amber-600 dark:text-amber-400',
        Math.abs(value) > tolerance && 'text-red-600 dark:text-red-400',
      )}
    >
      {text}
    </span>
  );
}

/** Count first, then see how it compares: a blind count keeps it honest. */
export function CloseShiftPanel() {
  const [result, setResult] = useState<CloseResult | null>(null);
  if (!result) return <ShiftCloseForm onDone={setResult} />;
  const balanced =
    Math.abs(result.cashVarianceCents) <= TOLERANCE.cashCents &&
    Math.abs(result.mpesaVarianceCents) <= TOLERANCE.mpesaCents &&
    Math.abs(result.milkVarianceMl) <= TOLERANCE.milkMl;
  return (
    <div className="grid gap-4" role="status">
      <p className="flex items-center gap-2 text-lg font-semibold">
        {balanced ? (
          <CheckCircle2 className="size-6 text-green-700 dark:text-green-400" aria-hidden />
        ) : (
          <TriangleAlert className="size-6 text-amber-600 dark:text-amber-400" aria-hidden />
        )}
        {balanced ? 'Shift balanced' : 'Shift closed with a difference'}
      </p>
      <dl className="grid gap-2 rounded-lg border p-4 text-sm">
        <div className="flex justify-between gap-3">
          <dt>Cash</dt>
          <dd>
            <Variance value={result.cashVarianceCents} kind="cash" />
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>M-Pesa</dt>
          <dd>
            <Variance value={result.mpesaVarianceCents} kind="mpesa" />
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Milk</dt>
          <dd>
            <Variance value={result.milkVarianceMl} kind="milk" />
          </dd>
        </div>
      </dl>
      <p className="text-sm text-muted-foreground">The owner will check and sign it off.</p>
      <Button variant="outline" className="h-11" onClick={() => setResult(null)}>
        Close another shift
      </Button>
    </div>
  );
}

/** The owner's sign-off, optionally writing a milk shortfall off as spoilage. */
export function CloseReviewButtons({ closeId, shortfallMl }: { closeId: string; shortfallMl: number }) {
  const [pending, startTransition] = useTransition();
  const signOff = (writeOffShortfall: boolean) =>
    startTransition(async () => {
      const result = await reviewShiftCloseAction({ closeId, writeOffShortfall });
      toast(
        result.ok
          ? { title: writeOffShortfall ? `Signed off; ${formatQuantity(shortfallMl)} written off` : 'Shift signed off' }
          : { variant: 'destructive', title: 'Not signed off', description: result.error },
      );
    });
  return (
    <div className="flex flex-wrap gap-2">
      <Button className="h-11 flex-1 gap-2 sm:flex-none" disabled={pending} onClick={() => signOff(false)}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />} Sign off
      </Button>
      {shortfallMl > 0 && (
        <Button variant="outline" className="h-11 flex-1 sm:flex-none" disabled={pending} onClick={() => signOff(true)}>
          Sign off &amp; write off {formatQuantity(shortfallMl)}
        </Button>
      )}
    </div>
  );
}
