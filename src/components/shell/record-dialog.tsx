'use client';

import { useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  Droplets,
  HandCoins,
  Receipt,
  ShoppingCart,
  Truck,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { SheetDialogContent } from '@/components/form-dialog';
import {
  CustomerPaymentForm,
  DeliveryForm,
  ExpenseForm,
  SaleForm,
  SpoilageForm,
  SupplierPaymentForm,
} from '@/components/forms/entry-forms';
import { Button } from '@/components/ui/button';
import { Dialog, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useEntryData } from './entry-data';

export type EntryKind = 'sale' | 'delivery' | 'payment' | 'spoilage' | 'supplier' | 'expense';

export interface EntryAction {
  kind: EntryKind;
  label: string;
  title: string;
  hint: string;
  icon: LucideIcon;
  ownerOnly?: boolean;
}

export const ENTRY_ACTIONS: EntryAction[] = [
  { kind: 'sale', label: 'Sale', title: 'Record a sale', hint: 'Milk sold', icon: ShoppingCart },
  { kind: 'delivery', label: 'Delivery in', title: 'Milk received', hint: 'From your milkman', icon: Truck },
  { kind: 'payment', label: 'Payment in', title: 'Customer payment', hint: 'Paying off deni', icon: HandCoins },
  { kind: 'spoilage', label: 'Spoilage', title: 'Milk lost or spoiled', hint: 'Sour or spilled', icon: Droplets },
  { kind: 'supplier', label: 'Pay supplier', title: 'Pay a supplier', hint: 'Money to the milkman', icon: Wallet, ownerOnly: true },
  { kind: 'expense', label: 'Expense', title: 'Record an expense', hint: 'Transport, rent…', icon: Receipt, ownerOnly: true },
];

export const actionsFor = (isOwner: boolean) => ENTRY_ACTIONS.filter((a) => !a.ownerOnly || isOwner);

function EntryForm({ kind, onDone }: { kind: EntryKind; onDone: () => void }) {
  const { customers, suppliers, defaultSalePriceCents } = useEntryData();
  switch (kind) {
    case 'sale':
      return <SaleForm customers={customers} defaultPriceCents={defaultSalePriceCents} onDone={onDone} />;
    case 'delivery':
      return <DeliveryForm suppliers={suppliers} onDone={onDone} />;
    case 'payment':
      return <CustomerPaymentForm customers={customers} onDone={onDone} />;
    case 'spoilage':
      return <SpoilageForm onDone={onDone} />;
    case 'supplier':
      return <SupplierPaymentForm suppliers={suppliers} onDone={onDone} />;
    case 'expense':
      return <ExpenseForm onDone={onDone} />;
  }
}

/**
 * One dialog for every ledger entry. With `initial` it opens straight on that
 * form (the Today tiles); without, it first asks what happened (the Record button).
 */
export function RecordDialog({ trigger, initial }: { trigger: ReactNode; initial?: EntryKind }) {
  const { isOwner } = useEntryData();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<EntryKind | null>(initial ?? null);
  const action = ENTRY_ACTIONS.find((a) => a.kind === kind);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setKind(initial ?? null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <SheetDialogContent>
        <DialogHeader className="flex-row items-center gap-2 space-y-0 text-left">
          {action && !initial && (
            <Button variant="ghost" size="icon" className="-ml-2 size-11 shrink-0" aria-label="Back" onClick={() => setKind(null)}>
              <ArrowLeft className="size-5" aria-hidden />
            </Button>
          )}
          <DialogTitle className="pr-8 text-xl">{action ? action.title : 'What happened?'}</DialogTitle>
        </DialogHeader>
        {open &&
          (action ? (
            <EntryForm kind={action.kind} onDone={() => onOpenChange(false)} />
          ) : (
            <ul className="grid grid-cols-2 gap-3">
              {actionsFor(isOwner).map(({ kind: k, label, hint, icon: Icon }) => (
                <li key={k}>
                  <button
                    type="button"
                    onClick={() => setKind(k)}
                    className="flex min-h-24 w-full flex-col items-start justify-between gap-2 rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <span className="rounded-lg bg-primary/10 p-2 text-primary">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span>
                      <span className="block font-semibold">{label}</span>
                      <span className="block text-xs text-muted-foreground">{hint}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ))}
      </SheetDialogContent>
    </Dialog>
  );
}
