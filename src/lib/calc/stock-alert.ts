/**
 * The one-line stock update the owner gets on WhatsApp when stock moves.
 * Pure, so the wording and the "is it worth a message" rules are unit-tested.
 */
import { formatQuantity, type QuantityUnit } from '@/lib/money';

/** Low = below zero, or at/below the reorder level (fresh milk has none). */
export function isLowStock(onHand: number, reorderLevel: number | null): boolean {
  return onHand < 0 || (reorderLevel != null && onHand <= reorderLevel);
}

export interface StockMovement {
  kind: 'delivery' | 'sale' | 'spoilage';
  /** A correction of an earlier entry (its volume is negative). */
  reversal: boolean;
  /** Signed thousandths of the unit, as stored on the ledger row. */
  volume: number;
  /** "fresh milk" or the product's name (it may start or sit mid-sentence). */
  itemName: string;
  unit: QuantityUnit;
  /** Stock on hand after this movement. */
  onHandAfter: number;
  reorderLevel: number | null;
  supplierName?: string | null;
  /** Spoilage reason (SPOILAGE_REASONS). */
  reason?: string | null;
}

/**
 * The message for one movement, or null when it isn't worth one. Deliveries,
 * write-offs and their cancellations always are. A sale is only when it takes
 * the item from OK to low, so the owner isn't messaged for every cup sold.
 */
export function stockAlertText(m: StockMovement): string | null {
  const qty = formatQuantity(Math.abs(m.volume), m.unit);
  const item = m.itemName;
  const left = formatQuantity(m.onHandAfter, m.unit);
  const low = isLowStock(m.onHandAfter, m.reorderLevel);
  const stockNow = `Stock now ${left}${low ? ' (running low)' : ''}.`;
  const by = m.supplierName ? ` from ${m.supplierName}` : '';

  switch (m.kind) {
    case 'sale': {
      if (m.reversal || m.volume <= 0) return null;
      const before = m.onHandAfter + m.volume;
      if (!low || isLowStock(before, m.reorderLevel)) return null;
      const Item = item.charAt(0).toUpperCase() + item.slice(1);
      if (m.onHandAfter < 0) return `${Item} stock is below zero (${left}). A delivery may not have been recorded.`;
      const reorder = m.reorderLevel != null ? ` (reorder at ${formatQuantity(m.reorderLevel, m.unit)})` : '';
      return `${Item} is running low: ${left} left${reorder}.`;
    }
    case 'delivery':
      return m.reversal
        ? `A delivery of ${qty} of ${item}${by} was cancelled. ${stockNow}`
        : `${qty} of ${item} received${by}. ${stockNow}`;
    case 'spoilage': {
      if (m.reversal) return `A write-off of ${qty} of ${item} was cancelled. ${stockNow}`;
      const why = m.reason ? ` (${m.reason.replace(/_/g, ' ')})` : '';
      return `${qty} of ${item} written off${why}. ${stockNow}`;
    }
  }
}
