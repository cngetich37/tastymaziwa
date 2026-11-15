'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Smartphone, XCircle } from 'lucide-react';
import { mpesaStatusAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { normalizeKenyanPhone } from '@/lib/validation';

/** The customer's M-Pesa number, outside react-hook-form so the sale form's schema stays the same. */
export function MpesaPhoneField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
}) {
  return (
    <div className="grid gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <Label htmlFor="mpesa-phone" className="flex items-center gap-2">
        <Smartphone className="size-4 text-primary" aria-hidden /> Send an M-Pesa prompt to
      </Label>
      <Input
        id="mpesa-phone"
        type="tel"
        inputMode="tel"
        autoComplete="off"
        placeholder="0712 345 678"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby="mpesa-phone-help"
        className="h-11 bg-background text-base"
      />
      <p id="mpesa-phone-help" className={error ? 'text-sm text-red-600 dark:text-red-400' : 'text-xs text-muted-foreground'}>
        {error ?? 'They enter their PIN; the sale is recorded once M-Pesa confirms. Leave blank if they paid already.'}
      </p>
    </div>
  );
}

/** Client-side check before sending; the server checks again. */
export function checkMpesaPhone(raw: string): { phone: string | null; error: string | null } {
  if (!raw.trim()) return { phone: null, error: null };
  const phone = normalizeKenyanPhone(raw);
  return phone ? { phone, error: null } : { phone: null, error: 'Enter a Kenyan mobile number, e.g. 0712 345 678' };
}

const POLL_MS = 3000;
const GIVE_UP_MS = 2 * 60 * 1000;

/**
 * Waits for the customer to answer the prompt: polls the request (the server
 * asks Daraja itself if the callback is late) until it is paid or not.
 */
export function MpesaPromptStatus({
  requestId,
  phone,
  onPaid,
  onRetry,
}: {
  requestId: string;
  phone: string;
  onPaid: () => void;
  onRetry: () => void;
}) {
  const [state, setState] = useState<{ status: 'pending' | 'succeeded' | 'failed' | 'unknown'; message: string }>({
    status: 'pending',
    message: 'Waiting for the customer to enter their M-Pesa PIN…',
  });

  useEffect(() => {
    let stopped = false;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const result = await mpesaStatusAction({ requestId });
      if (stopped) return;
      if (result.ok) {
        setState({ status: result.data.status, message: result.data.message });
        if (result.data.status === 'succeeded') {
          toast({ title: result.data.message });
          return;
        }
        if (result.data.status === 'failed') return;
      }
      if (Date.now() - started > GIVE_UP_MS) {
        setState({
          status: 'unknown',
          message: "No answer from M-Pesa yet. If the customer paid, it will show up under Finance → M-Pesa.",
        });
        return;
      }
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [requestId]);

  return (
    <div role="status" aria-live="polite" className="grid gap-4 py-2 text-center">
      <div className="mx-auto">
        {state.status === 'pending' && <Loader2 className="size-12 animate-spin text-primary" aria-hidden />}
        {state.status === 'succeeded' && <CheckCircle2 className="size-12 text-green-700 dark:text-green-400" aria-hidden />}
        {(state.status === 'failed' || state.status === 'unknown') && (
          <XCircle className="size-12 text-red-600 dark:text-red-400" aria-hidden />
        )}
      </div>
      <div>
        <p className="text-lg font-semibold">
          {state.status === 'succeeded' ? 'Paid' : state.status === 'pending' ? `Prompt sent to ${phone}` : 'Not paid'}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{state.message}</p>
      </div>
      {state.status === 'succeeded' ? (
        <Button className="h-11" onClick={onPaid}>
          Done
        </Button>
      ) : state.status !== 'pending' ? (
        <Button variant="outline" className="h-11" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
