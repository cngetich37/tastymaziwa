'use client';
/** Client-side dialog triggers for use inside Server Component pages. */

import { useTransition } from 'react';
import { Archive, ArchiveRestore, Pencil, Plus } from 'lucide-react';
import { archiveProductAction } from '@/app/actions';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { FormDialog } from '@/components/form-dialog';
import {
  CustomerForm,
  EditCustomerForm,
  EditProductForm,
  ProductForm,
  type ProductDetails,
  EditSupplierForm,
  InviteStaffForm,
  InviteSupplierForm,
  SubscriptionForm,
  SupplierForm,
  type CustomerDetails,
  type CustomerOption,
  type SupplierDetails,
} from '@/components/forms/entry-forms';

const AddButton = ({ label, ...props }: { label: string }) => (
  <Button variant="outline" className="h-11 gap-1" {...props}>
    <Plus className="h-4 w-4" aria-hidden /> {label}
  </Button>
);

const EditButton = (props: object) => (
  <Button variant="outline" className="h-11 gap-2" {...props}>
    <Pencil className="h-4 w-4" aria-hidden /> Edit
  </Button>
);

export function AddCustomerButton() {
  return (
    <FormDialog trigger={<AddButton label="Customer" />} title="Add customer">
      {(close) => <CustomerForm onDone={close} />}
    </FormDialog>
  );
}

export function EditCustomerButton({ customer }: { customer: CustomerDetails }) {
  return (
    <FormDialog trigger={<EditButton />} title="Edit customer">
      {(close) => <EditCustomerForm customer={customer} onDone={close} />}
    </FormDialog>
  );
}

export function AddSubscriptionButton({
  customers,
  defaultPriceCents,
  customerId,
}: {
  customers: CustomerOption[];
  defaultPriceCents: number | null;
  /** Preset when opened from a customer's page. */
  customerId?: string;
}) {
  return (
    <FormDialog
      trigger={<AddButton label="Subscription" />}
      title="New daily subscription"
      description="Billed to the customer's account each day it is active."
    >
      {(close) => (
        <SubscriptionForm
          customers={customers}
          defaultPriceCents={defaultPriceCents}
          defaultCustomerId={customerId}
          onDone={close}
        />
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

export function EditSupplierButton({ supplier }: { supplier: SupplierDetails }) {
  return (
    <FormDialog trigger={<EditButton />} title="Edit supplier">
      {(close) => <EditSupplierForm supplier={supplier} onDone={close} />}
    </FormDialog>
  );
}

export function InviteStaffButton() {
  return (
    <FormDialog
      trigger={<AddButton label="Invite" />}
      title="Invite a team member"
      description="Sellers record sales and approve the deliveries suppliers record, at your prices. Owners (admins) also set prices, see profit and reports, manage people, and correct entries. Give a milkman a login from their supplier page."
    >
      {(close) => <InviteStaffForm onDone={close} />}
    </FormDialog>
  );
}

export function InviteSupplierButton({ supplierId, supplierName }: { supplierId: string; supplierName: string }) {
  return (
    <FormDialog
      trigger={<AddButton label="Give them a login" />}
      title={`A login for ${supplierName}`}
      description="They record each delivery themselves; your seller checks the litres and approves it. They see only their own deliveries and what you owe them."
    >
      {(close) => <InviteSupplierForm supplierId={supplierId} supplierName={supplierName} onDone={close} />}
    </FormDialog>
  );
}

export function AddProductButton() {
  return (
    <FormDialog
      trigger={
        <Button className="h-11 gap-2">
          <Plus className="size-4" aria-hidden /> Product
        </Button>
      }
      title="Add a product"
      description="Anything you sell besides fresh milk. Stock comes in when you record it bought, and goes out as it is sold."
    >
      {(close) => <ProductForm onDone={close} />}
    </FormDialog>
  );
}

export function EditProductButton({ product }: { product: ProductDetails }) {
  return (
    <FormDialog
      trigger={
        <Button variant="ghost" size="icon" className="size-11" aria-label={`Edit ${product.name}`}>
          <Pencil className="size-4" aria-hidden />
        </Button>
      }
      title={`Edit ${product.name}`}
      description="New prices apply from now on. Past sales keep theirs."
    >
      {(close) => <EditProductForm product={product} onDone={close} />}
    </FormDialog>
  );
}

/** Stop (or resume) selling a product. Its history stays. */
export function ArchiveProductButton({ id, name, archived }: { id: string; name: string; archived: boolean }) {
  const [pending, startTransition] = useTransition();
  const Icon = archived ? ArchiveRestore : Archive;
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-11"
      disabled={pending}
      aria-label={archived ? `Sell ${name} again` : `Stop selling ${name}`}
      title={archived ? 'Sell again' : 'Stop selling'}
      onClick={() => {
        if (!archived && !confirm(`Stop selling ${name}? It disappears from the sale form; its history stays.`)) return;
        startTransition(async () => {
          const result = await archiveProductAction({ productId: id, archived: !archived });
          toast(
            result.ok
              ? { title: archived ? `${name} is back on sale` : `${name} archived` }
              : { variant: 'destructive', title: 'Not changed', description: result.error },
          );
        });
      }}
    >
      <Icon className="size-4" aria-hidden />
    </Button>
  );
}
