'use client';

import { useState, useTransition } from 'react';
import { Loader2, Undo2 } from 'lucide-react';
import { reverseEntryAction } from '@/app/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { formatShortDate, formatTime } from '@/lib/dates';
import { formatKES, formatKESSigned, formatLitres } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { LedgerListItem } from '@/server/queries';

const KIND_LABEL: Record<LedgerListItem['kind'], string> = {
  sale: 'Sale',
  delivery: 'Delivery',
  customer_payment: 'Payment in',
  supplier_payment: 'Paid supplier',
  expense: 'Expense',
  spoilage: 'Spoilage',
};

const METHOD_LABEL = { cash: 'cash', mpesa: 'M-Pesa', credit: 'credit' } as const;

/** Cash-flow sign: money in is positive, money out negative, credit sales neutral. */
function cashEffect(e: LedgerListItem): number | null {
  switch (e.kind) {
    case 'sale':
      return e.paymentMethod === 'credit' ? null : e.amountCents;
    case 'customer_payment':
      return e.amountCents;
    case 'supplier_payment':
    case 'expense':
      return -e.amountCents;
    default:
      return null;
  }
}

/** Buying prices and delivery costs: owners only. */
const isCost = (e: LedgerListItem) => e.kind === 'delivery' || e.kind === 'supplier_payment';

function describe(e: LedgerListItem, hideCosts = false): string {
  const parts: string[] = [];
  if (e.volumeMl) {
    parts.push(
      e.unitPriceCents != null && !(hideCosts && isCost(e))
        ? `${formatLitres(Math.abs(e.volumeMl))} @ ${formatKES(e.unitPriceCents)}`
        : formatLitres(Math.abs(e.volumeMl)),
    );
  }
  if (e.customerName) parts.push(e.customerName);
  if (e.supplierName) parts.push(e.supplierName);
  if (e.category) parts.push(e.category.replace(/_/g, ' '));
  if (e.paymentMethod && e.kind !== 'delivery') parts.push(METHOD_LABEL[e.paymentMethod]);
  return parts.join(' · ');
}

export function EntryList({
  entries,
  canReverse = false,
  hideCosts = false,
  emptyText = 'Nothing recorded yet.',
}: {
  entries: LedgerListItem[];
  canReverse?: boolean;
  /** For attendants: deliveries show litres, never the buying price. */
  hideCosts?: boolean;
  emptyText?: string;
}) {
  const [target, setTarget] = useState<LedgerListItem | null>(null);

  if (entries.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <>
      <ul className="divide-y">
        {entries.map((e) => {
          const reversed = Boolean(e.reversedById);
          const isReversal = Boolean(e.reversesId);
          const cash = cashEffect(e);
          return (
            <li key={e.id} className={cn('flex items-start gap-3 py-3', reversed && 'opacity-60')}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn('font-medium', reversed && 'line-through')}>{KIND_LABEL[e.kind]}</span>
                  {isReversal && <Badge variant="outline">Reversal</Badge>}
                  {reversed && <Badge variant="secondary">Reversed</Badge>}
                </div>
                <p className="truncate text-sm text-muted-foreground">{describe(e, hideCosts)}</p>
                <p className="text-xs text-muted-foreground">
                  {formatShortDate(e.businessDate)} · {formatTime(new Date(e.occurredAt))}
                  {e.createdByName ? ` · ${e.createdByName}` : ''}
                  {e.note ? ` · ${e.note}` : ''}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span
                  className={cn(
                    'font-mono text-sm font-medium tabular-nums',
                    cash != null && cash > 0 && 'text-green-700 dark:text-green-400',
                    cash != null && cash < 0 && 'text-red-600 dark:text-red-400',
                  )}
                >
                  {hideCosts && isCost(e)
                    ? formatLitres(e.volumeMl)
                    : cash != null
                    ? formatKESSigned(cash)
                    : e.amountCents
                      ? formatKES(e.amountCents)
                      : formatLitres(e.volumeMl)}
                </span>
                {canReverse && !reversed && !isReversal && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    onClick={() => setTarget(e)}
                  >
                    <Undo2 className="mr-1 h-3 w-3" aria-hidden /> Reverse
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <ReverseDialog entry={target} onClose={() => setTarget(null)} />
    </>
  );
}

function ReverseDialog({ entry, onClose }: { entry: LedgerListItem | null; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      if (!entry) return;
      const result = await reverseEntryAction({ entryId: entry.id, reason });
      if (result.ok) {
        toast({ title: 'Entry reversed' });
        setReason('');
        onClose();
      } else {
        toast({ variant: 'destructive', title: 'Not reversed', description: result.error });
      }
    });

  return (
    <Dialog open={entry != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reverse this {entry ? KIND_LABEL[entry.kind].toLowerCase() : 'entry'}?</DialogTitle>
          <DialogDescription>
            The original stays in the history and a cancelling entry is added. This can&apos;t be
            undone.
          </DialogDescription>
        </DialogHeader>
        {entry && <p className="rounded-md bg-muted p-3 text-sm">{describe(entry)}</p>}
        <div className="grid gap-2">
          <Label htmlFor="reverse-reason">Reason</Label>
          <Input
            id="reverse-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Typed 50 instead of 5"
            className="h-11"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={pending || reason.trim().length < 3}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Reverse entry'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
