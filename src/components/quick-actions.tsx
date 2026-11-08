'use client';

import type { ReactNode } from 'react';
import { Droplets, HandCoins, ShoppingCart, Truck, type LucideIcon } from 'lucide-react';
import { FormDialog } from '@/components/form-dialog';
import {
  CustomerPaymentForm,
  DeliveryForm,
  SaleForm,
  SpoilageForm,
  type CustomerOption,
  type SupplierOption,
} from '@/components/forms/entry-forms';

function ActionTile({ icon: Icon, label, ...props }: { icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      {...props}
      className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl border bg-card p-3 text-sm font-medium shadow-xs transition-colors hover:border-primary hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Icon className="h-6 w-6 text-primary" aria-hidden />
      {label}
    </button>
  );
}

function Tile({ icon, label, title, children }: {
  icon: LucideIcon;
  label: string;
  title: string;
  children: (close: () => void) => ReactNode;
}) {
  return (
    <FormDialog trigger={<ActionTile icon={icon} label={label} />} title={title}>
      {children}
    </FormDialog>
  );
}

export function QuickActions({
  customers,
  suppliers,
  defaultSalePriceCents,
}: {
  customers: CustomerOption[];
  suppliers: SupplierOption[];
  defaultSalePriceCents: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Tile icon={ShoppingCart} label="Sale" title="Record a sale">
        {(close) => (
          <SaleForm customers={customers} defaultPriceCents={defaultSalePriceCents} onDone={close} />
        )}
      </Tile>
      <Tile icon={Truck} label="Delivery in" title="Milk received">
        {(close) => <DeliveryForm suppliers={suppliers} onDone={close} />}
      </Tile>
      <Tile icon={HandCoins} label="Payment in" title="Customer payment">
        {(close) => <CustomerPaymentForm customers={customers} onDone={close} />}
      </Tile>
      <Tile icon={Droplets} label="Spoilage" title="Milk lost or spoiled">
        {(close) => <SpoilageForm onDone={close} />}
      </Tile>
    </div>
  );
}
