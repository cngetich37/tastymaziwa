'use client';

import { Banknote, NotebookPen, Smartphone } from 'lucide-react';
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
import { ChoiceField, SelectField, SubmitButton, TextField, type Option, type Preset } from './fields';
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
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'mpesa', label: 'M-Pesa', icon: Smartphone },
];
const SALE_METHODS: Option[] = [...IMMEDIATE_METHODS, { value: 'credit', label: 'Credit (deni)', icon: NotebookPen }];

/** The usual counter quantities: one tap instead of typing. */
const litrePresets = (values: string[]): Preset[] =>
  values.map((v) => ({ value: v, label: `${v === '0.5' ? '½' : v} L` }));

/** Live "litres × price" total in cents, or null while the inputs are incomplete. */
function previewTotalCents(litres: unknown, price: unknown): number | null {
  try {
    if (typeof litres !== 'string' || typeof price !== 'string' || !litres || !price) return null;
    return lineTotalCents(litresToMl(litres), kesToCents(price));
  } catch {
    return null;
  }
}

function TotalLine({ cents, detail }: { cents: number | null; detail?: string | null }) {
  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3" aria-live="polite">
      <p className="flex items-baseline justify-between gap-3 text-sm text-muted-foreground">
        Total: <span className="text-2xl font-bold text-foreground tabular-nums">{cents == null ? '—' : formatKES(cents)}</span>
      </p>
      {detail && <p className="mt-1 text-right text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

function NoSuppliers() {
  return (
    <p className="rounded-lg bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
      Add the milkman you buy from in <strong>Settings → Suppliers</strong> first.
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
  const [litres, price, method, customerId] = form.watch(['litres', 'pricePerLitre', 'paymentMethod', 'customerId']);
  const total = previewTotalCents(litres, price);
  const customer = method === 'credit' ? customers.find((c) => c.id === customerId) : undefined;

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        <TextField name="litres" label="Litres" kind="litres" autoFocus presets={litrePresets(['0.5', '1', '2', '5'])} />
        <TextField name="pricePerLitre" label="Price / litre" kind="money" />
        <ChoiceField name="paymentMethod" label="Paid by" options={SALE_METHODS} />
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
        <TotalLine
          cents={total}
          detail={customer && total != null ? `${customer.name} will owe ${formatKES(customer.balanceCents + total)}` : null}
        />
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
    return <NoSuppliers />;
  }

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
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
        <TotalLine cents={previewTotalCents(litres, price)} />
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
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        <TextField name="litres" label="Litres lost" kind="litres" autoFocus presets={litrePresets(['0.5', '1', '2'])} />
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
  const selected = customers.find((c) => c.id === form.watch('customerId'));
  const owed = selected && selected.balanceCents > 0 ? selected.balanceCents : 0;
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        <SelectField name="customerId" label="Customer" options={customerOptions(customers)} />
        <TextField
          name="amount"
          label="Amount paid"
          kind="money"
          presets={owed ? [{ value: centsToKesString(owed), label: `Full balance · ${formatKES(owed)}` }] : undefined}
        />
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
  if (suppliers.length === 0) return <NoSuppliers />;
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
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
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
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
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
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
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
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
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
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
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
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
