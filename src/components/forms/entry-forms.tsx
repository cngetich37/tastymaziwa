'use client';

import { Form } from '@/components/ui/form';
import {
  createCustomerAction,
  createSubscriptionAction,
  createSupplierAction,
  inviteStaffAction,
  recordCustomerPaymentAction,
  recordDeliveryAction,
  recordExpenseAction,
  recordSaleAction,
  recordSpoilageAction,
  recordSupplierPaymentAction,
} from '@/app/actions';
import { todayBusinessDate } from '@/lib/dates';
import { centsToKesString, formatKES, kesToCents, lineTotalCents, litresToMl } from '@/lib/money';
import {
  EXPENSE_CATEGORIES,
  SPOILAGE_REASONS,
  customerPaymentSchema,
  customerSchema,
  deliverySchema,
  expenseSchema,
  inviteStaffSchema,
  saleSchema,
  spoilageSchema,
  subscriptionSchema,
  supplierPaymentSchema,
  supplierSchema,
} from '@/lib/validation';
import { ChoiceField, SelectField, SubmitButton, TextField, type Option } from './fields';
import { useActionForm } from './use-action-form';

export interface CustomerOption {
  id: string;
  name: string;
  balanceCents: number;
}

export interface SupplierOption {
  id: string;
  name: string;
  defaultPricePerLitreCents: number | null;
}

interface FormProps {
  onDone?: () => void;
}

const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const toOptions = (values: readonly string[]): Option[] =>
  values.map((value) => ({ value, label: titleCase(value) }));

const customerOptions = (customers: CustomerOption[]): Option[] =>
  customers.map((c) => ({
    value: c.id,
    label: c.balanceCents ? `${c.name} · owes ${formatKES(c.balanceCents)}` : c.name,
  }));

const IMMEDIATE_METHODS: Option[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'mpesa', label: 'M-Pesa' },
];

/** Live "litres × price" total, or null while the inputs are incomplete. */
function previewTotal(litres: unknown, price: unknown): string | null {
  try {
    if (typeof litres !== 'string' || typeof price !== 'string' || !litres || !price) return null;
    return formatKES(lineTotalCents(litresToMl(litres), kesToCents(price)));
  } catch {
    return null;
  }
}

function TotalLine({ value }: { value: string | null }) {
  return (
    <p className="rounded-md bg-muted px-3 py-2 text-sm" aria-live="polite">
      Total: <span className="font-semibold">{value ?? '—'}</span>
    </p>
  );
}

// --- sales & stock ----------------------------------------------------------

export function SaleForm({
  customers,
  defaultPriceCents,
  onDone,
}: FormProps & { customers: CustomerOption[]; defaultPriceCents: number }) {
  const { form, onSubmit, pending } = useActionForm(
    saleSchema,
    recordSaleAction,
    {
      litres: '',
      pricePerLitre: centsToKesString(defaultPriceCents),
      paymentMethod: 'cash',
      customerId: '',
      dueDate: '',
      note: '',
    },
    { success: 'Sale recorded', onSuccess: onDone },
  );
  const [litres, price, method] = form.watch(['litres', 'pricePerLitre', 'paymentMethod']);

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <TextField name="litres" label="Litres" kind="litres" autoFocus />
          <TextField name="pricePerLitre" label="Price / litre" kind="money" />
        </div>
        <ChoiceField
          name="paymentMethod"
          label="Paid by"
          options={[...IMMEDIATE_METHODS, { value: 'credit', label: 'Credit (deni)' }]}
        />
        {method === 'credit' && (
          <>
            <SelectField name="customerId" label="Customer" options={customerOptions(customers)} />
            <TextField
              name="dueDate"
              label="Pay by (optional)"
              kind="date"
              description="Defaults to 7 days from today."
            />
          </>
        )}
        <TotalLine value={previewTotal(litres, price)} />
        <SubmitButton pending={pending}>Record sale</SubmitButton>
      </form>
    </Form>
  );
}

export function DeliveryForm({ suppliers, onDone }: FormProps & { suppliers: SupplierOption[] }) {
  const first = suppliers[0];
  const { form, onSubmit, pending } = useActionForm(
    deliverySchema,
    recordDeliveryAction,
    {
      supplierId: first?.id ?? '',
      litres: '',
      pricePerLitre:
        first?.defaultPricePerLitreCents != null ? centsToKesString(first.defaultPricePerLitreCents) : '',
      note: '',
    },
    { success: 'Delivery recorded', onSuccess: onDone },
  );
  const [litres, price] = form.watch(['litres', 'pricePerLitre']);

  if (suppliers.length === 0) {
    return <p className="text-sm text-muted-foreground">Add a supplier in Settings first.</p>;
  }

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        {suppliers.length > 1 && (
          <SelectField
            name="supplierId"
            label="Supplier"
            options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
          />
        )}
        <div className="grid grid-cols-2 gap-3">
          <TextField name="litres" label="Litres received" kind="litres" autoFocus />
          <TextField name="pricePerLitre" label="Cost / litre" kind="money" />
        </div>
        <TotalLine value={previewTotal(litres, price)} />
        <SubmitButton pending={pending}>Record delivery</SubmitButton>
      </form>
    </Form>
  );
}

export function SpoilageForm({ onDone }: FormProps) {
  const { form, onSubmit, pending } = useActionForm(
    spoilageSchema,
    recordSpoilageAction,
    { litres: '', reason: 'sour', note: '' },
    { success: 'Spoilage recorded', onSuccess: onDone },
  );
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <TextField name="litres" label="Litres lost" kind="litres" autoFocus />
        <SelectField name="reason" label="Reason" options={toOptions(SPOILAGE_REASONS)} />
        <TextField name="note" label="Note (optional)" />
        <SubmitButton pending={pending}>Record spoilage</SubmitButton>
      </form>
    </Form>
  );
}

// --- money in / out ---------------------------------------------------------

export function CustomerPaymentForm({
  customers,
  defaultCustomerId,
  onDone,
}: FormProps & { customers: CustomerOption[]; defaultCustomerId?: string }) {
  const { form, onSubmit, pending } = useActionForm(
    customerPaymentSchema,
    recordCustomerPaymentAction,
    { customerId: defaultCustomerId ?? '', amount: '', paymentMethod: 'mpesa', note: '' },
    { success: 'Payment received', onSuccess: onDone },
  );
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <SelectField name="customerId" label="Customer" options={customerOptions(customers)} />
        <TextField name="amount" label="Amount paid" kind="money" />
        <ChoiceField name="paymentMethod" label="Paid by" options={IMMEDIATE_METHODS} />
        <SubmitButton pending={pending}>Record payment</SubmitButton>
      </form>
    </Form>
  );
}

export function SupplierPaymentForm({ suppliers, onDone }: FormProps & { suppliers: SupplierOption[] }) {
  const { form, onSubmit, pending } = useActionForm(
    supplierPaymentSchema,
    recordSupplierPaymentAction,
    { supplierId: suppliers[0]?.id ?? '', amount: '', paymentMethod: 'cash', note: '' },
    { success: 'Supplier payment recorded', onSuccess: onDone },
  );
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <SelectField
          name="supplierId"
          label="Supplier"
          options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
        />
        <TextField name="amount" label="Amount paid" kind="money" />
        <ChoiceField name="paymentMethod" label="Paid by" options={IMMEDIATE_METHODS} />
        <SubmitButton pending={pending}>Record payment</SubmitButton>
      </form>
    </Form>
  );
}

export function ExpenseForm({ onDone }: FormProps) {
  const { form, onSubmit, pending } = useActionForm(
    expenseSchema,
    recordExpenseAction,
    { category: 'transport', amount: '', note: '' },
    { success: 'Expense recorded', onSuccess: onDone },
  );
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <SelectField name="category" label="Category" options={toOptions(EXPENSE_CATEGORIES)} />
        <TextField name="amount" label="Amount" kind="money" />
        <TextField name="note" label="Note (optional)" />
        <SubmitButton pending={pending}>Record expense</SubmitButton>
      </form>
    </Form>
  );
}

// --- master data ------------------------------------------------------------

export function CustomerForm({ onDone }: FormProps) {
  const { form, onSubmit, pending } = useActionForm(
    customerSchema,
    createCustomerAction,
    { name: '', phone: '', address: '' },
    { success: 'Customer added', onSuccess: onDone },
  );
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <TextField name="name" label="Name" autoFocus />
        <TextField name="phone" label="Phone (optional)" kind="tel" placeholder="0712 345 678" />
        <TextField name="address" label="Location (optional)" />
        <SubmitButton pending={pending}>Add customer</SubmitButton>
      </form>
    </Form>
  );
}

export function SubscriptionForm({
  customers,
  defaultPriceCents,
  onDone,
}: FormProps & { customers: CustomerOption[]; defaultPriceCents: number }) {
  const { form, onSubmit, pending } = useActionForm(
    subscriptionSchema,
    createSubscriptionAction,
    {
      customerId: '',
      dailyLitres: '',
      pricePerLitre: centsToKesString(defaultPriceCents),
      startDate: todayBusinessDate(),
    },
    { success: 'Subscription created', onSuccess: onDone },
  );
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <SelectField name="customerId" label="Customer" options={customerOptions(customers)} />
        <div className="grid grid-cols-2 gap-3">
          <TextField name="dailyLitres" label="Litres per day" kind="litres" />
          <TextField name="pricePerLitre" label="Price / litre" kind="money" />
        </div>
        <TextField name="startDate" label="Start date" kind="date" />
        <SubmitButton pending={pending}>Create subscription</SubmitButton>
      </form>
    </Form>
  );
}

export function SupplierForm({ onDone }: FormProps) {
  const { form, onSubmit, pending } = useActionForm(
    supplierSchema,
    createSupplierAction,
    { name: '', phone: '', defaultPricePerLitre: '' },
    { success: 'Supplier added', onSuccess: onDone },
  );
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <TextField name="name" label="Name" />
        <TextField name="phone" label="Phone (optional)" kind="tel" />
        <TextField name="defaultPricePerLitre" label="Usual price / litre (optional)" kind="money" />
        <SubmitButton pending={pending}>Add supplier</SubmitButton>
      </form>
    </Form>
  );
}

export function InviteStaffForm({ onDone }: FormProps) {
  const { form, onSubmit, pending } = useActionForm(
    inviteStaffSchema,
    inviteStaffAction,
    { name: '', email: '', role: 'attendant' },
    { success: 'Invite sent', onSuccess: onDone },
  );
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <TextField name="name" label="Full name" />
        <TextField
          name="email"
          label="Email"
          kind="email"
          description="They'll get a link to set their password, or can sign in with an emailed code."
        />
        <ChoiceField
          name="role"
          label="Role"
          options={[
            { value: 'attendant', label: 'Attendant' },
            { value: 'owner', label: 'Owner' },
          ]}
        />
        <SubmitButton pending={pending}>Send invite</SubmitButton>
      </form>
    </Form>
  );
}
