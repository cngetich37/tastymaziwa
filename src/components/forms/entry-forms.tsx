'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Banknote, CalendarClock, Lock, NotebookPen, Smartphone } from 'lucide-react';
import { Form } from '@/components/ui/form';
import {
  createCustomerAction,
  createProductAction,
  createSubscriptionAction,
  createSupplierAction,
  inviteStaffAction,
  paySuppliersAction,
  setBudgetsAction,
  submitShiftCloseAction,
  inviteSupplierAction,
  recordCustomerPaymentAction,
  recordDeliveryAction,
  recordExpenseAction,
  recordSaleAction,
  recordSpoilageAction,
  recordSupplierPaymentAction,
  reviewDeliveryAction,
  setSalePriceAction,
  submitDeliveryAction,
  updateCustomerAction,
  updateProductAction,
  updateSupplierAction,
} from '@/app/actions';
import type { ProductUnit } from '@/db/schema';
import { formatLongDate, todayBusinessDate, type BusinessDate } from '@/lib/dates';
import { centsToKesString, formatKES, formatQuantity, kesToCents, lineTotalCents, litresToMl } from '@/lib/money';
import {
  EXPENSE_CATEGORIES,
  SPOILAGE_REASONS,
  customerPaymentSchema,
  customerSchema,
  deliverySchema,
  expenseSchema,
  inviteStaffSchema,
  inviteSupplierSchema,
  productSchema,
  reviewDeliverySchema,
  salePriceSchema,
  budgetsSchema,
  paySuppliersSchema,
  shiftCloseSchema,
  saleSchema,
  spoilageSchema,
  submitDeliverySchema,
  subscriptionSchema,
  supplierPaymentSchema,
  supplierSchema,
  updateCustomerSchema,
  updateProductSchema,
  updateSupplierSchema,
} from '@/lib/validation';
import { ChoiceField, SelectField, SubmitButton, TextField, type Option, type Preset } from './fields';
import { useActionForm } from './use-action-form';

export interface CustomerOption {
  id: string;
  name: string;
  balanceCents: number;
  /** Null = no limit. */
  creditLimitCents?: number | null;
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
  /** Has their own login: records their deliveries, which the seller approves. */
  selfRecords: boolean;
}

/** A product other than milk, as the counter forms see it. */
export interface ProductOption {
  id: string;
  name: string;
  unit: ProductUnit;
  salePriceCents: number | null;
  /** Only sent to owners. */
  costPriceCents: number | null;
}

const UNIT_WORD: Record<ProductUnit, string> = { litre: 'litre', piece: 'piece', kg: 'kg' };
const UNIT_SUFFIX: Record<ProductUnit, string> = { litre: 'L', piece: 'pcs', kg: 'kg' };
const PRESETS: Record<ProductUnit, string[]> = {
  litre: ['0.5', '1', '2', '5'],
  piece: ['1', '2', '3', '5'],
  kg: ['0.25', '0.5', '1'],
};
const presetsFor = (unit: ProductUnit): Preset[] =>
  PRESETS[unit].map((v) => ({ value: v, label: formatQuantity(Number(v) * 1000, unit).replace('0.5 L', '½ L') }));

/** "Milk" plus each product, as one-tap chips. */
const productChoices = (products: ProductOption[]): Option[] => [
  { value: '', label: 'Milk' },
  ...products.map((p) => ({ value: p.id, label: p.name })),
];

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

/** "Jane will owe Ksh 450" plus a warning when it passes their limit. */
function creditDetail(customer: CustomerOption, totalCents: number, isOwner: boolean): string {
  const after = customer.balanceCents + totalCents;
  const limit = customer.creditLimitCents;
  if (limit != null && after > limit) {
    return `${customer.name} would owe ${formatKES(after)}, over the ${formatKES(limit)} limit${isOwner ? '' : ': ask the owner'}`;
  }
  return `${customer.name} will owe ${formatKES(after)}${limit != null ? ` of ${formatKES(limit)}` : ''}`;
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
  products = [],
  salePriceCents,
  canEditPrice,
  defaultCustomerId,
  date,
  onDone,
}: FormProps &
  DatedProps & {
    customers: CustomerOption[];
    /** Products other than milk. */
    products?: ProductOption[];
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
      productId: '',
      customerId: defaultCustomerId ?? '',
      dueDate: '',
      date: date ?? '',
      note: '',
    },
    { success: 'Sale recorded', onSuccess: onDone },
  );
  const [litres, price, method, customerId, productId] = form.watch([
    'litres',
    'pricePerLitre',
    'paymentMethod',
    'customerId',
    'productId',
  ]);
  const product = products.find((p) => p.id === productId);
  const unit: ProductUnit = product?.unit ?? 'litre';
  const fixedCents = product ? product.salePriceCents : salePriceCents;

  // Switching product brings in its price (owners can still change it).
  const lastProduct = useRef(productId);
  useEffect(() => {
    if (productId === lastProduct.current) return;
    lastProduct.current = productId;
    if (canEditPrice) form.setValue('pricePerLitre', priceString(fixedCents));
  }, [canEditPrice, productId, fixedCents, form]);

  if (!canEditPrice && salePriceCents == null && products.length === 0) {
    return <Notice>The owner hasn&apos;t set a selling price yet, so sales can&apos;t be recorded.</Notice>;
  }

  const unitCents = canEditPrice ? parsePrice(price) : fixedCents;
  const total = previewTotalCents(litres, unitCents);
  const customer = method === 'credit' ? customers.find((c) => c.id === customerId) : undefined;

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        <PastDayNotice date={date} />
        {products.length > 0 && <ChoiceField name="productId" label="Product" options={productChoices(products)} wrap />}
        <TextField
          name="litres"
          label={product ? `Quantity (${UNIT_SUFFIX[unit]})` : 'Litres'}
          kind="litres"
          suffix={UNIT_SUFFIX[unit]}
          autoFocus
          presets={presetsFor(unit)}
        />
        {canEditPrice ? (
          <TextField
            name="pricePerLitre"
            label={product ? `Price / ${UNIT_WORD[unit]}` : 'Price / litre'}
            kind="money"
            description={
              fixedCents != null
                ? `Usual price ${formatKES(fixedCents)}. A change here is for this sale only.`
                : product
                  ? `Set ${product.name}'s price under Inventory so sellers can sell it.`
                  : 'Set a shop price in Settings so sellers can sell.'
            }
          />
        ) : fixedCents != null ? (
          <FixedPrice cents={fixedCents} />
        ) : (
          <p className="text-sm text-red-600 dark:text-red-400">
            The owner hasn&apos;t set a price for {product?.name ?? 'milk'} yet, so it can&apos;t be sold.
          </p>
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
          detail={customer && total != null ? creditDetail(customer, total, canEditPrice) : null}
        />
        <SubmitButton pending={pending}>Record sale</SubmitButton>
      </form>
    </Form>
  );
}

export function DeliveryForm({
  suppliers,
  products = [],
  canEditPrice,
  defaultSupplierId,
  date,
  onDone,
}: FormProps &
  DatedProps & {
    suppliers: SupplierOption[];
    canEditPrice: boolean;
    defaultSupplierId?: string;
    /** Owners can also record stock bought in (mala, packets…). */
    products?: ProductOption[];
  }) {
  // Sellers only type in deliveries for suppliers without their own login;
  // the rest record their own, and the seller approves them instead.
  const allSuppliers = suppliers;
  suppliers = canEditPrice ? allSuppliers : allSuppliers.filter((s) => !s.selfRecords);
  const initial = suppliers.find((s) => s.id === defaultSupplierId) ?? suppliers[0];
  const { form, onSubmit, pending } = useActionForm(
    deliverySchema,
    recordDeliveryAction,
    {
      supplierId: initial?.id ?? '',
      productId: '',
      litres: '',
      pricePerLitre: canEditPrice ? priceString(initial?.defaultPricePerLitreCents) : '',
      date: date ?? '',
      note: '',
    },
    { success: 'Delivery recorded', onSuccess: onDone },
  );
  const [supplierId, litres, price, productId] = form.watch(['supplierId', 'litres', 'pricePerLitre', 'productId']);
  const supplier = suppliers.find((s) => s.id === supplierId);
  const product = canEditPrice ? products.find((p) => p.id === productId) : undefined;
  const unit: ProductUnit = product?.unit ?? 'litre';

  // Switching supplier or product brings in the agreed price / usual cost.
  const last = useRef(`${supplierId}|${productId}`);
  useEffect(() => {
    const key = `${supplierId}|${productId}`;
    if (!canEditPrice || key === last.current) return;
    last.current = key;
    form.setValue('pricePerLitre', priceString(product ? product.costPriceCents : supplier?.defaultPricePerLitreCents));
  }, [canEditPrice, supplierId, productId, supplier, product, form]);

  if (allSuppliers.length === 0) return <NoSuppliers />;
  if (suppliers.length === 0) {
    return (
      <Notice>
        Your suppliers record their own deliveries. Check the litres and approve them under{' '}
        <strong>Deliveries → Waiting for approval</strong>.
      </Notice>
    );
  }

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
        {canEditPrice && products.length > 0 && (
          <ChoiceField name="productId" label="What came in" options={productChoices(products)} wrap />
        )}
        <TextField
          name="litres"
          label={product ? `Quantity received (${UNIT_SUFFIX[unit]})` : 'Litres received'}
          kind="litres"
          suffix={UNIT_SUFFIX[unit]}
          autoFocus
        />
        {canEditPrice && !product && supplier?.selfRecords && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            {supplier.name} records their own deliveries for approval. Only record one here if they can&apos;t.
          </p>
        )}
        {canEditPrice ? (
          <>
            <TextField
              name="pricePerLitre"
              label={product ? `Cost / ${UNIT_WORD[unit]}` : 'Cost / litre'}
              kind="money"
              description={
                product
                  ? `Buying ${product.name} for stock.`
                  : supplier?.defaultPricePerLitreCents != null
                  ? `Agreed price ${formatKES(supplier.defaultPricePerLitreCents)}. A change here is for this delivery only.`
                  : 'No agreed price yet: set one on the supplier page so deliveries can be recorded and approved.'
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

// --- finance ----------------------------------------------------------------------

export interface PayableSupplier {
  id: string;
  name: string;
  payableCents: number;
}

/**
 * Settle several suppliers at once. Each line starts at the full amount owed;
 * clear a line to skip that supplier. `runKey` makes the run safe to retry.
 */
export function PaySuppliersForm({
  suppliers,
  runKey,
  onDone,
}: {
  suppliers: PayableSupplier[];
  runKey: string;
  onDone: (r: { paid: number; totalCents: number }) => void;
}) {
  const { form, onSubmit, pending } = useActionForm(
    paySuppliersSchema,
    paySuppliersAction,
    {
      runKey,
      paymentMethod: 'mpesa',
      lines: suppliers.map((s) => ({ supplierId: s.id, amount: centsToKesString(s.payableCents) })),
    },
    {
      success: (r) =>
        r.paid === 0 ? 'This run was already paid' : `Paid ${r.paid} supplier${r.paid === 1 ? '' : 's'} ${formatKES(r.totalCents)}`,
      onSuccess: onDone,
    },
  );
  const lines = form.watch('lines');
  const total = lines.reduce((n, l) => n + (parsePrice(l.amount) ?? 0), 0);
  const linesError = form.formState.errors.lines?.message ?? form.formState.errors.lines?.root?.message;

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        <ul className="grid gap-3">
          {suppliers.map((s, i) => (
            <li key={s.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_12rem] sm:items-end">
              <div>
                <p className="font-semibold">{s.name}</p>
                <p className="text-sm text-muted-foreground">Owed {formatKES(s.payableCents)}</p>
              </div>
              <TextField name={`lines.${i}.amount`} label={`Pay ${s.name}`} kind="money" />
            </li>
          ))}
        </ul>
        {linesError && <p className="text-sm text-red-600 dark:text-red-400">{linesError}</p>}
        <ChoiceField name="paymentMethod" label="Paid by" options={IMMEDIATE_METHODS} />
        <TotalLine cents={total} detail="Clear an amount to skip that supplier." />
        <SubmitButton pending={pending}>Pay {formatKES(total)}</SubmitButton>
      </form>
    </Form>
  );
}

/** One monthly budget per expense category; leave blank for none. */
export function BudgetsForm({ budgets, onDone }: FormProps & { budgets: Record<string, number | null> }) {
  const { form, onSubmit, pending } = useActionForm(
    budgetsSchema,
    setBudgetsAction,
    { budgets: EXPENSE_CATEGORIES.map((c) => ({ category: c, monthly: priceString(budgets[c]) })) },
    { success: 'Budgets saved', onSuccess: onDone, keepValues: true },
  );
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        {EXPENSE_CATEGORIES.map((c, i) => (
          <TextField key={c} name={`budgets.${i}.monthly`} label={titleCase(c)} kind="money" />
        ))}
        <SubmitButton pending={pending}>Save budgets</SubmitButton>
      </form>
    </Form>
  );
}

// --- shift close ------------------------------------------------------------------

export interface CloseResult {
  cashVarianceCents: number;
  mpesaVarianceCents: number;
  milkVarianceMl: number;
}

/**
 * The seller's blind count: what is in the drawer, on the M-Pesa statement
 * and in the churn. Expected figures are only revealed after submitting.
 */
export function ShiftCloseForm({ onDone }: { onDone?: (r: CloseResult) => void }) {
  const { form, onSubmit, pending } = useActionForm(
    shiftCloseSchema,
    submitShiftCloseAction,
    { openingFloat: '', countedCash: '', countedMpesa: '', countedMilk: '', note: '' },
    { success: 'Shift closed', onSuccess: (r) => onDone?.(r) },
  );
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        <TextField
          name="openingFloat"
          label="Float at the start (optional)"
          kind="money"
          description="Cash that was in the drawer when the shift began."
        />
        <TextField name="countedCash" label="Cash in the drawer now" kind="money" />
        <TextField
          name="countedMpesa"
          label="M-Pesa received this shift"
          kind="money"
          description="From the till or phone statement."
        />
        <TextField name="countedMilk" label="Milk left (litres)" kind="litres" description="Measure what is in the churns." />
        <TextField name="note" label="Note (optional)" />
        <SubmitButton pending={pending}>Close shift</SubmitButton>
      </form>
    </Form>
  );
}

// --- products -------------------------------------------------------------------

export interface ProductDetails {
  id: string;
  name: string;
  unit: ProductUnit;
  salePriceCents: number | null;
  costPriceCents: number | null;
  reorderLevel: number | null;
}

const UNIT_OPTIONS: Option[] = [
  { value: 'piece', label: 'Pieces' },
  { value: 'litre', label: 'Litres' },
  { value: 'kg', label: 'Kilograms' },
];

const quantityString = (milli: number | null | undefined) => (milli != null ? String(milli / 1000) : '');

function ProductFields() {
  return (
    <>
      <TextField name="name" label="Name" description="e.g. Mala 500ml, Yoghurt 250ml, Ghee" />
      <ChoiceField name="unit" label="Sold by" options={UNIT_OPTIONS} />
      <TextField name="salePrice" label="Selling price" kind="money" description="Per piece, litre or kg. Sellers always use it." />
      <TextField name="costPrice" label="Usual buying price (optional)" kind="money" />
      <TextField
        name="reorderLevel"
        label="Warn when stock falls to (optional)"
        kind="litres"
        suffix=""
        description="Shows the product as low on stock."
      />
    </>
  );
}

export function ProductForm({ onDone }: FormProps) {
  const { form, onSubmit, pending } = useActionForm(
    productSchema,
    createProductAction,
    { name: '', unit: 'piece', salePrice: '', costPrice: '', reorderLevel: '' },
    { success: 'Product added', onSuccess: onDone },
  );
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        <ProductFields />
        <SubmitButton pending={pending}>Add product</SubmitButton>
      </form>
    </Form>
  );
}

export function EditProductForm({ product, onDone }: FormProps & { product: ProductDetails }) {
  const { form, onSubmit, pending } = useActionForm(
    updateProductSchema,
    updateProductAction,
    {
      productId: product.id,
      name: product.name,
      unit: product.unit,
      salePrice: priceString(product.salePriceCents),
      costPrice: priceString(product.costPriceCents),
      reorderLevel: quantityString(product.reorderLevel),
    },
    { success: 'Product saved', onSuccess: onDone, keepValues: true },
  );
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        <ProductFields />
        <SubmitButton pending={pending}>Save changes</SubmitButton>
      </form>
    </Form>
  );
}

// --- supplier-recorded deliveries ---------------------------------------------

/** The supplier's own form: litres only, at the price agreed with the shop. */
export function SubmitDeliveryForm({ priceCents, onDone }: FormProps & { priceCents: number | null }) {
  const { form, onSubmit, pending } = useActionForm(
    submitDeliverySchema,
    submitDeliveryAction,
    { litres: '', note: '' },
    { success: 'Sent to the shop for approval', onSuccess: onDone },
  );
  const litres = form.watch('litres');
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        <TextField
          name="litres"
          label="Litres delivered"
          kind="litres"
          presets={litrePresets(['10', '20', '40', '50'])}
        />
        <TextField name="note" label="Note (optional)" description="e.g. Morning run, 2 cans" />
        {priceCents != null && (
          <TotalLine
            cents={previewTotalCents(litres, priceCents)}
            detail={`At the agreed ${formatKES(priceCents)} per litre, once approved`}
          />
        )}
        <SubmitButton pending={pending}>Send for approval</SubmitButton>
      </form>
    </Form>
  );
}

/** The seller sends a supplier's delivery back: the reason is shown to the supplier. */
export function RejectDeliveryForm({ submissionId, onDone }: FormProps & { submissionId: string }) {
  const { form, onSubmit, pending } = useActionForm(
    reviewDeliverySchema,
    reviewDeliveryAction,
    { submissionId, decision: 'reject', reason: '' },
    { success: 'Delivery sent back to the supplier', onSuccess: onDone },
  );
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        <TextField
          name="reason"
          label="What was wrong?"
          autoFocus
          description="The supplier sees this and records the delivery again."
        />
        <SubmitButton pending={pending}>Reject delivery</SubmitButton>
      </form>
    </Form>
  );
}

/** Gives a supplier their own login to record deliveries. */
export function InviteSupplierForm({
  supplierId,
  supplierName,
  onDone,
}: FormProps & { supplierId: string; supplierName: string }) {
  const { form, onSubmit, pending } = useActionForm(
    inviteSupplierSchema,
    inviteSupplierAction,
    { supplierId, name: supplierName, email: '' },
    { success: 'Invite sent', onSuccess: onDone },
  );
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        <TextField name="name" label="Their name" />
        <TextField
          name="email"
          label="Email"
          kind="email"
          description="They'll get a link to set a password, or can sign in with an emailed code."
        />
        <SubmitButton pending={pending}>Send invite</SubmitButton>
      </form>
    </Form>
  );
}

export function SpoilageForm({
  date,
  products = [],
  defaultProductId,
  onDone,
}: FormProps & DatedProps & { products?: ProductOption[]; defaultProductId?: string }) {
  const { form, onSubmit, pending } = useActionForm(
    spoilageSchema,
    recordSpoilageAction,
    { productId: defaultProductId ?? '', litres: '', reason: 'sour', date: date ?? '', note: '' },
    { success: 'Spoilage recorded', onSuccess: onDone },
  );
  const product = products.find((p) => p.id === form.watch('productId'));
  const unit: ProductUnit = product?.unit ?? 'litre';
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        <PastDayNotice date={date} />
        {products.length > 0 && <ChoiceField name="productId" label="What was lost" options={productChoices(products)} wrap />}
        <TextField
          name="litres"
          label={product ? `Quantity lost (${UNIT_SUFFIX[unit]})` : 'Litres lost'}
          kind="litres"
          suffix={UNIT_SUFFIX[unit]}
          autoFocus
          presets={presetsFor(unit).slice(0, 3)}
        />
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
    { category: 'transport', amount: '', paymentMethod: 'cash', date: date ?? '', note: '' },
    { success: 'Expense recorded', onSuccess: onDone },
  );
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        <PastDayNotice date={date} />
        <SelectField name="category" label="Category" options={toOptions(EXPENSE_CATEGORIES)} />
        <TextField name="amount" label="Amount" kind="money" />
        <ChoiceField name="paymentMethod" label="Paid by" options={IMMEDIATE_METHODS} />
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
  creditLimitCents: number | null;
}

export function CustomerForm({ onDone }: FormProps) {
  const { form, onSubmit, pending } = useActionForm(
    customerSchema,
    createCustomerAction,
    { name: '', phone: '', address: '', creditLimit: '' },
    { success: 'Customer added', onSuccess: onDone },
  );
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        <TextField name="name" label="Name" autoFocus />
        <TextField name="phone" label="Phone (optional)" kind="tel" placeholder="0712 345 678" />
        <TextField name="address" label="Location (optional)" />
        <TextField
          name="creditLimit"
          label="Credit limit (optional)"
          kind="money"
          description="Sellers can't sell on credit past this. Leave blank for no limit."
        />
        <SubmitButton pending={pending}>Add customer</SubmitButton>
      </form>
    </Form>
  );
}

export function EditCustomerForm({ customer, onDone }: FormProps & { customer: CustomerDetails }) {
  const { form, onSubmit, pending } = useActionForm(
    updateCustomerSchema,
    updateCustomerAction,
    {
      customerId: customer.id,
      name: customer.name,
      phone: customer.phone ?? '',
      address: customer.address ?? '',
      creditLimit: priceString(customer.creditLimitCents),
    },
    { success: 'Customer updated', onSuccess: onDone, keepValues: true },
  );
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        <TextField name="name" label="Name" />
        <TextField name="phone" label="Phone (optional)" kind="tel" placeholder="0712 345 678" />
        <TextField name="address" label="Location (optional)" />
        <TextField
          name="creditLimit"
          label="Credit limit (optional)"
          kind="money"
          description="Sellers can't sell on credit past this. Leave blank for no limit."
        />
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
          description="Deliveries are recorded and approved at this price. You can add it later."
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
            { value: 'attendant', label: 'Seller' },
            { value: 'owner', label: 'Owner (admin)' },
          ]}
        />
        <SubmitButton pending={pending}>Send invite</SubmitButton>
      </form>
    </Form>
  );
}
