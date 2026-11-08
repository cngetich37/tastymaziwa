'use client';
/** Client-side dialog triggers for use inside Server Component pages. */

import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormDialog } from '@/components/form-dialog';
import {
  CustomerForm,
  CustomerPaymentForm,
  SubscriptionForm,
  SupplierForm,
  InviteStaffForm,
  type CustomerOption,
} from '@/components/forms/entry-forms';

const AddButton = ({ label, ...props }: { label: string }) => (
  <Button size="sm" variant="outline" className="h-9 gap-1" {...props}>
    <Plus className="h-4 w-4" aria-hidden /> {label}
  </Button>
);

export function AddCustomerButton() {
  return (
    <FormDialog trigger={<AddButton label="Customer" />} title="Add customer">
      {(close) => <CustomerForm onDone={close} />}
    </FormDialog>
  );
}

export function AddSubscriptionButton({
  customers,
  defaultPriceCents,
}: {
  customers: CustomerOption[];
  defaultPriceCents: number;
}) {
  return (
    <FormDialog
      trigger={<AddButton label="Subscription" />}
      title="New daily subscription"
      description="Billed to the customer's account each day it is active."
    >
      {(close) => (
        <SubscriptionForm customers={customers} defaultPriceCents={defaultPriceCents} onDone={close} />
      )}
    </FormDialog>
  );
}

export function ReceivePaymentButton({
  customers,
  customerId,
}: {
  customers: CustomerOption[];
  customerId: string;
}) {
  return (
    <FormDialog
      trigger={
        <Button size="sm" variant="ghost" className="h-9">
          Receive
        </Button>
      }
      title="Customer payment"
    >
      {(close) => (
        <CustomerPaymentForm customers={customers} defaultCustomerId={customerId} onDone={close} />
      )}
    </FormDialog>
  );
}

export function AddSupplierButton() {
  return (
    <FormDialog trigger={<AddButton label="Supplier" />} title="Add supplier">
      {(close) => <SupplierForm onDone={close} />}
    </FormDialog>
  );
}

export function InviteStaffButton() {
  return (
    <FormDialog
      trigger={<AddButton label="Invite" />}
      title="Invite a team member"
      description="Attendants record sales, deliveries and payments. Owners also see profit, reverse entries and manage the team."
    >
      {(close) => <InviteStaffForm onDone={close} />}
    </FormDialog>
  );
}
