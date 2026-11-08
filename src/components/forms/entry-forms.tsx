'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Banknote, CalendarClock, Lock, NotebookPen, Smartphone } from 'lucide-react';
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
  setSalePriceAction,
  updateCustomerAction,
  updateSupplierAction,
} from '@/app/actions';
import { formatLongDate, todayBusinessDate, type BusinessDate } from '@/lib/dates';
import { centsToKesString, formatKES, kesToCents, lineTotalCents, litresToMl } from '@/lib/money';
import {
  EXPENSE_CATEGORIES,
  SPOILAGE_REASONS,
  customerPaymentSchema,
  customerSchema,
  deliverySchema,
  expenseSchema,
  inviteStaffSchema,
  salePriceSchema,
  saleSchema,
  spoilageSchema,
  subscriptionSchema,
  supplierPaymentSchema,
  supplierSchema,
  updateCustomerSchema,
  updateSupplierSchema,
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
  /** Only sent to owners: attendants never see buying prices. */
  defaultPricePerLitreCents: number | null;
  /** Whether the owner has agreed a price, so an attendant can record a delivery. */
  priceSet: boolean;
  /** Only sent to owners: what the shop owes this supplier. */
  payableCents?: number;
}

interface FormProps {
  onDone?: () => void;
}

/** Owners may date an entry on a past day (from that day's page). */
interface DatedProps {
  date?: BusinessDate;
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

const priceString = (cents: number | null | undefined) => (cents != null ? centsToKesString(cents) : '');

/** Live "litres × price" total in cents, or null while the inputs are incomplete. */
function previewTotalCents(litres: unknown, priceCents: number | null): number | null {
  try {
    if (typeof litres !== 'string' || !litres || priceCents == null) return null;
    return lineTotalCents(litresToMl(litres), priceCents);
  } catch {
    return null;
  }
}

function parsePrice(value: unknown): number | null {
  try {
    return typeof value === 'string' && value ? kesToCents(value) : null;
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

/** The owner's price, shown read-only to attendants. */
function FixedPrice({ cents }: { cents: number }) {
  return (
    <p className="flex items-center justify-between gap-3 rounded-lg bg-muted px-4 py-3 text-sm">
      <span className="flex items-center gap-2 text-muted-foreground">
        <Lock className="size-4" aria-hidden /> Price per litre
      </span>
      <span className="font-semibold tabular-nums">{formatKES(cents)}</span>
    </p>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-muted px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

function PastDayNotice({ date }: { date?: BusinessDate }) {
  if (!date || date === todayBusinessDate()) return null;
  return (
    <p className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
      <CalendarClock className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
      Recording for {formatLongDate(date)}
    </p>
  );
}

function NoSuppliers() {
  return (
    <Notice>
      Add the milkman you buy from in <strong>Suppliers</strong> first.
    </Notice>
  );
}

// --- sales & stock ----------------------------------------------------------

export function SaleForm({
  customers,
  salePriceCents,
  canEditPrice,
  defaultCustomerId,
  date,
  onDone,
}: FormProps &
  DatedProps & {
    customers: CustomerOption[];
    /** The shop's selling price, set by the owner. */
    salePriceCents: number | null;
    /** Owners may change the price for this one sale. */
    canEditPrice: boolean;
    defaultCustomerId?: string;
  }) {
  const { form, onSubmit, pending } = useActionForm(
    saleSchema,
    recordSaleAction,
    {
      litres: '',
      // Blank = the shop's price, decided on the server.
      pricePerLitre: canEditPrice ? priceString(salePriceCents) : '',
      paymentMethod: defaultCustomerId ? 'credit' : 'cash',
      customerId: defaultCustomerId ?? '',
      dueDate: '',
      date: date ?? '',
      note: '',
    },
    { success: 'Sale recorded', onSuccess: onDone },
  );
  const [litres, price, method, customerId] = form.watch(['litres', 'pricePerLitre', 'paymentMethod', 'customerId']);

  if (!canEditPrice && salePriceCents == null) {
    return <Notice>The owner hasn&apos;t set a selling price yet, so sales can&apos;t be recorded.</Notice>;
  }

  const unitCents = canEditPrice ? parsePrice(price) : salePriceCents;
  const total = previewTotalCents(litres, unitCents);
  const customer = method === 'credit' ? customers.find((c) => c.id === customerId) : undefined;

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        <PastDayNotice date={date} />
        <TextField name="litres" label="Litres" kind="litres" autoFocus presets={litrePresets(['0.5', '1', '2', '5'])} />
        {canEditPrice ? (
          <TextField
            name="pricePerLitre"
            label="Price / litre"
            kind="money"
            description={
              salePriceCents != null
                ? `Shop price ${formatKES(salePriceCents)}. A change here is for this sale only.`
                : 'Set a shop price in Settings so attendants can sell.'
            }
          />
        ) : (
          <FixedPrice cents={salePriceCents!} />
        )}
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

export function DeliveryForm({
  suppliers,
  canEditPrice,
  defaultSupplierId,
  date,
  onDone,
}: FormProps &
  DatedProps & { suppliers: SupplierOption[]; canEditPrice: boolean; defaultSupplierId?: string }) {
  const initial = suppliers.find((s) => s.id === defaultSupplierId) ?? suppliers[0];
  const { form, onSubmit, pending } = useActionForm(
    deliverySchema,
    recordDeliveryAction,
    {
      supplierId: initial?.id ?? '',
      litres: '',
      pricePerLitre: canEditPrice ? priceString(initial?.defaultPricePerLitreCents) : '',
      date: date ?? '',
      note: '',
    },
    { success: 'Delivery recorded', onSuccess: onDone },
  );
  const [supplierId, litres, price] = form.watch(['supplierId', 'litres', 'pricePerLitre']);
  const supplier = suppliers.find((s) => s.id === supplierId);

  // Switching supplier brings in that supplier's agreed price.
  const lastSupplier = useRef(supplierId);
  useEffect(() => {
    if (!canEditPrice || supplierId === lastSupplier.current) return;
    lastSupplier.current = supplierId;
    form.setValue('pricePerLitre', priceString(supplier?.defaultPricePerLitreCents));
  }, [canEditPrice, supplierId, supplier, form]);

  if (suppliers.length === 0) return <NoSuppliers />;

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        <PastDayNotice date={date} />
        {suppliers.length > 1 && (
          <SelectField
            name="supplierId"
            label="Supplier"
            options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
          />
        )}
        <TextField name="litres" label="Litres received" kind="litres" autoFocus />
        {canEditPrice ? (
          <>
            <TextField
              name="pricePerLitre"
              label="Cost / litre"
              kind="money"
              description={
                supplier?.defaultPricePerLitreCents != null
                  ? `Agreed price ${formatKES(supplier.defaultPricePerLitreCents)}. A change here is for this delivery only.`
                  : 'No agreed price yet: set one on the supplier page so attendants can record deliveries.'
              }
            />
            <TotalLine cents={previewTotalCents(litres, parsePrice(price))} />
          </>
        ) : (
          supplier &&
          !supplier.priceSet && (
            <p className="text-sm text-red-600 dark:text-red-400">
              The owner hasn&apos;t set {supplier.name}&apos;s price yet, so this delivery can&apos;t be recorded.
            </p>
          )
        )}
        <SubmitButton pending={pending}>Record delivery</SubmitButton>
      </form>
    </Form>
  );
}

export function SpoilageForm({ date, onDone }: FormProps & DatedProps) {
  const { form, onSubmit, pending } = useActionForm(
    spoilageSchema,
    recordSpoilageAction,
    { litres: '', reason: 'sour', date: date ?? '', note: '' },
    { success: 'Spoilage recorded', onSuccess: onDone },
  );
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        <PastDayNotice date={date} />
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
  date,
  onDone,
}: FormProps & DatedProps & { customers: CustomerOption[]; defaultCustomerId?: string }) {
  const { form, onSubmit, pending } = useActionForm(
    customerPaymentSchema,
    recordCustomerPaymentAction,
    { customerId: defaultCustomerId ?? '', amount: '', paymentMethod: 'mpesa', date: date ?? '', note: '' },
    { success: 'Payment received', onSuccess: onDone },
  );
  const selected = customers.find((c) => c.id === form.watch('customerId'));
  const owed = selected && selected.balanceCents > 0 ? selected.balanceCents : 0;
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        <PastDayNotice date={date} />
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

export function SupplierPaymentForm({
  suppliers,
  defaultSupplierId,
  date,
  onDone,
}: FormProps &
  DatedProps & {
    suppliers: SupplierOption[];
    defaultSupplierId?: string;
  }) {
  const { form, onSubmit, pending } = useActionForm(
    supplierPaymentSchema,
    recordSupplierPaymentAction,
    {
      supplierId: defaultSupplierId ?? suppliers[0]?.id ?? '',
      amount: '',
      paymentMethod: 'cash',
      date: date ?? '',
      note: '',
    },
    { success: 'Supplier payment recorded', onSuccess: onDone },
  );
  const owed = suppliers.find((s) => s.id === form.watch('supplierId'))?.payableCents ?? 0;
  if (suppliers.length === 0) return <NoSuppliers />;
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        <PastDayNotice date={date} />
        <SelectField
          name="supplierId"
          label="Supplier"
          options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
        />
        <TextField
          name="amount"
          label="Amount paid"
          kind="money"
          presets={owed > 0 ? [{ value: centsToKesString(owed), label: `Full balance · ${formatKES(owed)}` }] : undefined}
        />
        <ChoiceField name="paymentMethod" label="Paid by" options={IMMEDIATE_METHODS} />
        <SubmitButton pending={pending}>Record payment</SubmitButton>
      </form>
    </Form>
  );
}

export function ExpenseForm({ date, onDone }: FormProps & DatedProps) {
  const { form, onSubmit, pending } = useActionForm(
    expenseSchema,
    recordExpenseAction,
    { category: 'transport', amount: '', date: date ?? '', note: '' },
    { success: 'Expense recorded', onSuccess: onDone },
  );
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        <PastDayNotice date={date} />
        <SelectField name="category" label="Category" options={toOptions(EXPENSE_CATEGORIES)} />
        <TextField name="amount" label="Amount" kind="money" />
        <TextField name="note" label="Note (optional)" />
        <SubmitButton pending={pending}>Record expense</SubmitButton>
      </form>
    </Form>
  );
}

// --- master data ------------------------------------------------------------

export interface CustomerDetails {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
}

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

export function EditCustomerForm({ customer, onDone }: FormProps & { customer: CustomerDetails }) {
  const { form, onSubmit, pending } = useActionForm(
    updateCustomerSchema,
    updateCustomerAction,
    { customerId: customer.id, name: customer.name, phone: customer.phone ?? '', address: customer.address ?? '' },
    { success: 'Customer updated', onSuccess: onDone, keepValues: true },
  );
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        <TextField name="name" label="Name" />
        <TextField name="phone" label="Phone (optional)" kind="tel" placeholder="0712 345 678" />
        <TextField name="address" label="Location (optional)" />
        <SubmitButton pending={pending}>Save changes</SubmitButton>
      </form>
    </Form>
  );
}

export function SubscriptionForm({
  customers,
  defaultPriceCents,
  defaultCustomerId,
  onDone,
}: FormProps & { customers: CustomerOption[]; defaultPriceCents: number | null; defaultCustomerId?: string }) {
  const { form, onSubmit, pending } = useActionForm(
    subscriptionSchema,
    createSubscriptionAction,
    {
      customerId: defaultCustomerId ?? '',
      dailyLitres: '',
      pricePerLitre: priceString(defaultPriceCents),
      startDate: todayBusinessDate(),
    },
    { success: 'Subscription created', onSuccess: onDone },
  );
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        {!defaultCustomerId && <SelectField name="customerId" label="Customer" options={customerOptions(customers)} />}
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

export interface SupplierDetails {
  id: string;
  name: string;
  phone: string | null;
  defaultPricePerLitreCents: number | null;
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
        <TextField name="name" label="Name" autoFocus />
        <TextField name="phone" label="Phone (optional)" kind="tel" />
        <TextField
          name="defaultPricePerLitre"
          label="Agreed price / litre"
          kind="money"
          description="Attendants record deliveries at this price. You can add it later."
        />
        <SubmitButton pending={pending}>Add supplier</SubmitButton>
      </form>
    </Form>
  );
}

export function EditSupplierForm({ supplier, onDone }: FormProps & { supplier: SupplierDetails }) {
  const { form, onSubmit, pending } = useActionForm(
    updateSupplierSchema,
    updateSupplierAction,
    {
      supplierId: supplier.id,
      name: supplier.name,
      phone: supplier.phone ?? '',
      defaultPricePerLitre: priceString(supplier.defaultPricePerLitreCents),
    },
    { success: 'Supplier updated', onSuccess: onDone, keepValues: true },
  );
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        <TextField name="name" label="Name" />
        <TextField name="phone" label="Phone (optional)" kind="tel" />
        <TextField
          name="defaultPricePerLitre"
          label="Agreed price / litre"
          kind="money"
          description="New deliveries use this price. Past deliveries keep theirs."
        />
        <SubmitButton pending={pending}>Save changes</SubmitButton>
      </form>
    </Form>
  );
}

/** The selling price every attendant sale uses. */
export function SalePriceForm({ priceCents }: { priceCents: number | null }) {
  const { form, onSubmit, pending } = useActionForm(
    salePriceSchema,
    setSalePriceAction,
    { pricePerLitre: priceString(priceCents) },
    { success: 'Selling price saved', keepValues: true },
  );
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <TextField
          name="pricePerLitre"
          label="Selling price / litre"
          kind="money"
          description="Every sale uses this price. Past sales keep the price they were sold at."
        />
        <SubmitButton pending={pending}>Save price</SubmitButton>
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
