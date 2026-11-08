'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  CustomerPaymentForm,
  DeliveryForm,
  ExpenseForm,
  SaleForm,
  SpoilageForm,
  SupplierPaymentForm,
  type CustomerOption,
  type SupplierOption,
} from '@/components/forms/entry-forms';

export function LedgerForms({
  isOwner,
  customers,
  suppliers,
  defaultSalePriceCents,
}: {
  isOwner: boolean;
  customers: CustomerOption[];
  suppliers: SupplierOption[];
  defaultSalePriceCents: number;
}) {
  const tabs = [
    { value: 'sale', label: 'Sale', body: <SaleForm customers={customers} defaultPriceCents={defaultSalePriceCents} /> },
    { value: 'delivery', label: 'Delivery', body: <DeliveryForm suppliers={suppliers} /> },
    { value: 'payment', label: 'Payment in', body: <CustomerPaymentForm customers={customers} /> },
    { value: 'spoilage', label: 'Spoilage', body: <SpoilageForm /> },
    ...(isOwner
      ? [
          { value: 'supplier', label: 'Pay supplier', body: <SupplierPaymentForm suppliers={suppliers} /> },
          { value: 'expense', label: 'Expense', body: <ExpenseForm /> },
        ]
      : []),
  ];

  return (
    <Tabs defaultValue="sale">
      <TabsList className="mb-4 flex h-auto flex-wrap justify-start">
        {tabs.map((t) => (
          <TabsTrigger key={t.value} value={t.value} className="h-9">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.value} value={t.value}>
          {t.body}
        </TabsContent>
      ))}
    </Tabs>
  );
}
