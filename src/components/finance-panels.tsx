'use client';

import { useState } from 'react';
import { CheckCircle2, Target } from 'lucide-react';
import { FormDialog } from '@/components/form-dialog';
import {
  BudgetsForm,
  MpesaSettingsForm,
  PaySuppliersForm,
  type MpesaSettingsSummary,
  type PayableSupplier,
} from '@/components/forms/entry-forms';
import { Button } from '@/components/ui/button';
import { formatKES } from '@/lib/money';

/** A fresh run key per run, so a retry is safe but the next run is new. */
export function PayRun({ suppliers }: { suppliers: PayableSupplier[] }) {
  const [runKey, setRunKey] = useState(() => crypto.randomUUID());
  const [last, setLast] = useState<{ paid: number; totalCents: number } | null>(null);
  return (
    <div className="grid gap-4">
      {last && last.paid > 0 && (
        <p role="status" className="flex items-center gap-2 rounded-lg border border-green-600/30 bg-green-600/5 px-4 py-3 text-sm">
          <CheckCircle2 className="size-5 text-green-700 dark:text-green-400" aria-hidden />
          Paid {last.paid} supplier{last.paid === 1 ? '' : 's'} {formatKES(last.totalCents)}.
        </p>
      )}
      {suppliers.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          You don&apos;t owe any supplier right now.
        </p>
      ) : (
        <PaySuppliersForm
          key={runKey}
          runKey={runKey}
          suppliers={suppliers}
          onDone={(r) => {
            setLast(r);
            setRunKey(crypto.randomUUID());
          }}
        />
      )}
    </div>
  );
}

export function BudgetsButton({ budgets }: { budgets: Record<string, number | null> }) {
  return (
    <FormDialog
      trigger={
        <Button variant="outline" className="h-11 gap-2">
          <Target className="size-4" aria-hidden /> Budgets
        </Button>
      }
      title="Monthly budgets"
      description="What you plan to spend each month per category. Leave blank for no budget."
    >
      {(close) => <BudgetsForm budgets={budgets} onDone={close} />}
    </FormDialog>
  );
}

export function MpesaSettingsButton({ saved, shopName }: { saved: MpesaSettingsSummary | null; shopName: string }) {
  return (
    <FormDialog
      trigger={<Button className="h-11">{saved ? 'Edit M-Pesa' : 'Set up M-Pesa'}</Button>}
      title="Lipa na M-Pesa prompts"
      description="Your own Daraja app's keys, from developer.safaricom.co.ke. They are stored encrypted and never shown again."
    >
      {(close) => <MpesaSettingsForm saved={saved} shopName={shopName} onDone={close} />}
    </FormDialog>
  );
}
