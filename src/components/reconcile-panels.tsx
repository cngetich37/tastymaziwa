'use client';

import { useState, useTransition } from 'react';
import { Link2, Loader2, PlugZap, UserCheck } from 'lucide-react';
import {
  connectTillAction,
  ignoreC2bAction,
  matchC2bToCustomerAction,
  matchC2bToSaleAction,
  simulateTillPaymentAction,
} from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import type { ActionResult } from '@/lib/action-result';
import { formatTime } from '@/lib/dates';
import { formatKES } from '@/lib/money';
import { cn } from '@/lib/utils';

function useRun() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult<unknown>>, success: string, onOk?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast({ title: success });
        onOk?.();
      } else toast({ variant: 'destructive', title: 'Not saved', description: r.error });
    });
  return { pending, run };
}

const selectClass = 'h-11 w-full rounded-md border border-input bg-background px-3 text-base';

export interface InboxPayment {
  id: string;
  transId: string;
  transTime: Date;
  amountCents: number;
  payerName: string | null;
  billRef: string | null;
  customerId: string | null;
  customerName: string | null;
  sales: { id: string; occurredAt: Date; createdByName: string | null }[];
}

type Mode = 'customer' | 'sale' | 'ignore' | null;

/** One unmatched till payment and the owner's choices for it. */
export function InboxItem({ payment, customers }: { payment: InboxPayment; customers: { id: string; name: string }[] }) {
  const { pending, run } = useRun();
  const [mode, setMode] = useState<Mode>(null);
  const [customerId, setCustomerId] = useState(payment.customerId ?? '');
  const [entryId, setEntryId] = useState(payment.sales[0]?.id ?? '');
  const [note, setNote] = useState('');

  return (
    <li className="rounded-lg border bg-card p-3" aria-label={`Payment ${payment.transId}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-lg font-semibold">{formatKES(payment.amountCents)}</p>
        <p className="text-xs text-muted-foreground">
          {payment.transTime.toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short' })},{' '}
          {formatTime(payment.transTime)} · {payment.transId}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        {payment.payerName ?? 'Unknown payer'}
        {payment.billRef ? ` · account “${payment.billRef}”` : ''}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {payment.customerId && payment.customerName && (
          <Button
            className="h-11 gap-2"
            disabled={pending}
            onClick={() =>
              run(
                () => matchC2bToCustomerAction({ c2bId: payment.id, customerId: payment.customerId! }),
                `Recorded as ${payment.customerName}'s payment`,
              )
            }
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <UserCheck className="size-4" aria-hidden />}
            {payment.customerName} paying
          </Button>
        )}
        {(['customer', 'sale', 'ignore'] as const).map((m) => (
          <Button
            key={m}
            variant={mode === m ? 'secondary' : 'outline'}
            className="h-11"
            aria-pressed={mode === m}
            onClick={() => setMode(mode === m ? null : m)}
            disabled={m === 'sale' && payment.sales.length === 0}
            title={m === 'sale' && payment.sales.length === 0 ? `No open M-Pesa sale of ${formatKES(payment.amountCents)}` : undefined}
          >
            {m === 'customer' ? 'A customer paying' : m === 'sale' ? 'Pays for a sale' : 'Not shop money'}
          </Button>
        ))}
      </div>

      {mode === 'customer' && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <Label className="grid gap-1 text-sm">
            Customer
            <select className={selectClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Choose…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Label>
          <Button
            className="h-11"
            disabled={pending || !customerId}
            onClick={() => run(() => matchC2bToCustomerAction({ c2bId: payment.id, customerId }), 'Recorded as a customer payment')}
          >
            Record payment
          </Button>
        </div>
      )}
      {mode === 'sale' && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <Label className="grid gap-1 text-sm">
            M-Pesa sale of {formatKES(payment.amountCents)}
            <select className={selectClass} value={entryId} onChange={(e) => setEntryId(e.target.value)}>
              {payment.sales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.occurredAt.toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  {s.createdByName ? ` · ${s.createdByName}` : ''}
                </option>
              ))}
            </select>
          </Label>
          <Button
            className="h-11 gap-2"
            disabled={pending || !entryId}
            onClick={() => run(() => matchC2bToSaleAction({ c2bId: payment.id, entryId }), 'Matched to the sale')}
          >
            <Link2 className="size-4" aria-hidden /> Match
          </Button>
        </div>
      )}
      {mode === 'ignore' && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <Label className="grid gap-1 text-sm">
            What was it?
            <Input className="h-11 text-base" value={note} placeholder="e.g. Personal transfer" onChange={(e) => setNote(e.target.value)} />
          </Label>
          <Button
            variant="outline"
            className="h-11"
            disabled={pending || note.trim().length < 3}
            onClick={() => run(() => ignoreC2bAction({ c2bId: payment.id, note }), 'Set aside')}
          >
            Set aside
          </Button>
        </div>
      )}
    </li>
  );
}

/** Register the till's confirmation URL with Safaricom. */
export function ConnectTillButton({ connected }: { connected: boolean }) {
  const { pending, run } = useRun();
  return (
    <Button
      className={cn('h-11 gap-2', connected && 'bg-background text-foreground hover:bg-muted')}
      variant={connected ? 'outline' : 'default'}
      disabled={pending}
      onClick={() => {
        if (connected && !confirm('Connect again? Safaricom will use new links from now on.')) return;
        run(() => connectTillAction({}), 'Till connected: payments will show up here');
      }}
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <PlugZap className="size-4" aria-hidden />}
      {connected ? 'Connect again' : 'Connect till'}
    </Button>
  );
}

/** Sandbox only: make a pretend payment to see it arrive. */
export function SimulatePayment() {
  const { pending, run } = useRun();
  const [amount, setAmount] = useState('140');
  const [phone, setPhone] = useState('254708374149');
  return (
    <div className="grid gap-2 rounded-lg border border-dashed p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Label className="grid gap-1 text-sm">
        Test amount (KSh)
        <Input className="h-11 text-base" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Label>
      <Label className="grid gap-1 text-sm">
        From phone
        <Input className="h-11 text-base" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Label>
      <Button
        variant="outline"
        className="h-11"
        disabled={pending}
        onClick={() => run(() => simulateTillPaymentAction({ amount, phone }), 'Test payment sent: it appears here in a few seconds')}
      >
        Send test payment
      </Button>
    </div>
  );
}
