/**
 * Pure business calculations over ledger rows. Inputs may be raw entries or
 * pre-aggregated rows (same shape) — sums are linear, so both work.
 *
 * Sign convention: original entries carry non-negative amounts/volumes; a
 * reversal carries the negated values of the entry it cancels. Summing by kind
 * therefore nets reversals out automatically.
 */

export type EntryKind =
  | 'delivery'
  | 'sale'
  | 'customer_payment'
  | 'supplier_payment'
  | 'expense'
  | 'spoilage';

export type PaymentMethod = 'cash' | 'mpesa' | 'credit';

export interface LedgerRow {
  kind: EntryKind;
  paymentMethod: PaymentMethod | null;
  amountCents: number;
  volumeMl: number;
}

export interface Summary {
  salesCents: number;
  salesMl: number;
  cashSalesCents: number;
  mpesaSalesCents: number;
  creditSalesCents: number;
  deliveryCostCents: number;
  deliveredMl: number;
  spoiledMl: number;
  expensesCents: number;
  customerPaymentsCents: number;
  cashCustomerPaymentsCents: number;
  mpesaCustomerPaymentsCents: number;
  supplierPaymentsCents: number;
  /** Sales revenue minus the cost of milk bought in the period. */
  grossProfitCents: number;
  /** Gross profit minus operating expenses. */
  netProfitCents: number;
  /** Litres that should be left: delivered − sold − spoiled (may be negative if data is incomplete). */
  stockChangeMl: number;
}

export function emptySummary(): Summary {
  return {
    salesCents: 0,
    salesMl: 0,
    cashSalesCents: 0,
    mpesaSalesCents: 0,
    creditSalesCents: 0,
    deliveryCostCents: 0,
    deliveredMl: 0,
    spoiledMl: 0,
    expensesCents: 0,
    customerPaymentsCents: 0,
    cashCustomerPaymentsCents: 0,
    mpesaCustomerPaymentsCents: 0,
    supplierPaymentsCents: 0,
    grossProfitCents: 0,
    netProfitCents: 0,
    stockChangeMl: 0,
  };
}

export function summarize(rows: Iterable<LedgerRow>): Summary {
  const s = emptySummary();
  for (const row of rows) {
    switch (row.kind) {
      case 'sale':
        s.salesCents += row.amountCents;
        s.salesMl += row.volumeMl;
        if (row.paymentMethod === 'cash') s.cashSalesCents += row.amountCents;
        else if (row.paymentMethod === 'mpesa') s.mpesaSalesCents += row.amountCents;
        else if (row.paymentMethod === 'credit') s.creditSalesCents += row.amountCents;
        break;
      case 'delivery':
        s.deliveryCostCents += row.amountCents;
        s.deliveredMl += row.volumeMl;
        break;
      case 'spoilage':
        s.spoiledMl += row.volumeMl;
        break;
      case 'expense':
        s.expensesCents += row.amountCents;
        break;
      case 'customer_payment':
        s.customerPaymentsCents += row.amountCents;
        if (row.paymentMethod === 'cash') s.cashCustomerPaymentsCents += row.amountCents;
        else if (row.paymentMethod === 'mpesa') s.mpesaCustomerPaymentsCents += row.amountCents;
        break;
      case 'supplier_payment':
        s.supplierPaymentsCents += row.amountCents;
        break;
    }
  }
  s.grossProfitCents = s.salesCents - s.deliveryCostCents;
  s.netProfitCents = s.grossProfitCents - s.expensesCents;
  s.stockChangeMl = s.deliveredMl - s.salesMl - s.spoiledMl;
  return s;
}

/** What a customer owes: credit sales minus payments received. */
export function customerBalanceCents(rows: Iterable<LedgerRow>): number {
  const s = summarize(rows);
  return s.creditSalesCents - s.customerPaymentsCents;
}

/** What the shop owes a supplier: delivery cost minus payments made. */
export function supplierPayableCents(rows: Iterable<LedgerRow>): number {
  const s = summarize(rows);
  return s.deliveryCostCents - s.supplierPaymentsCents;
}

export interface DailyPoint {
  date: string;
  salesCents: number;
  grossProfitCents: number;
  netProfitCents: number;
}

/**
 * One point per date in `dates` (zero-filled), from rows tagged with their
 * business date.
 */
export function dailySeries(
  dates: string[],
  rows: Iterable<LedgerRow & { businessDate: string }>,
): DailyPoint[] {
  const byDate = new Map<string, LedgerRow[]>();
  for (const row of rows) {
    const bucket = byDate.get(row.businessDate);
    if (bucket) bucket.push(row);
    else byDate.set(row.businessDate, [row]);
  }
  return dates.map((date) => {
    const s = summarize(byDate.get(date) ?? []);
    return {
      date,
      salesCents: s.salesCents,
      grossProfitCents: s.grossProfitCents,
      netProfitCents: s.netProfitCents,
    };
  });
}
