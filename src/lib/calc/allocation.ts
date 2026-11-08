/**
 * Apply a customer's payments to their credit sales, oldest first (FIFO), to
 * work out which sales are still outstanding. Pure: the ledger stays the
 * source of truth and this is recomputed on read.
 */

export interface CreditSaleInput {
  id: string;
  businessDate: string;
  dueDate: string | null;
  amountCents: number;
  /** Tie-breaker for sales on the same business day. */
  occurredAt?: Date;
}

export type CreditStatus = 'paid' | 'partial' | 'outstanding';

export interface AllocatedCreditSale extends CreditSaleInput {
  paidCents: number;
  outstandingCents: number;
  status: CreditStatus;
}

export interface AllocationResult {
  sales: AllocatedCreditSale[];
  /** Payments beyond everything owed (customer is in credit). */
  unappliedCents: number;
}

export function allocatePayments(
  sales: CreditSaleInput[],
  totalPaidCents: number,
): AllocationResult {
  const ordered = [...sales].sort(
    (a, b) =>
      a.businessDate.localeCompare(b.businessDate) ||
      (a.occurredAt?.getTime() ?? 0) - (b.occurredAt?.getTime() ?? 0) ||
      a.id.localeCompare(b.id),
  );
  let remaining = Math.max(0, totalPaidCents);
  const allocated = ordered.map((sale): AllocatedCreditSale => {
    const amount = Math.max(0, sale.amountCents);
    const paid = Math.min(amount, remaining);
    remaining -= paid;
    const outstanding = amount - paid;
    return {
      ...sale,
      paidCents: paid,
      outstandingCents: outstanding,
      status: outstanding === 0 ? 'paid' : paid > 0 ? 'partial' : 'outstanding',
    };
  });
  return { sales: allocated, unappliedCents: remaining };
}
