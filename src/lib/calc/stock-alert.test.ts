import { describe, expect, it } from 'vitest';
import { isLowStock, stockAlertText, type StockMovement } from './stock-alert';

const milk = (m: Partial<StockMovement>): StockMovement => ({
  kind: 'delivery',
  reversal: false,
  volume: 40_000,
  itemName: 'fresh milk',
  unit: 'litre',
  onHandAfter: 52_000,
  reorderLevel: null,
  ...m,
});

describe('isLowStock', () => {
  it('is low below zero, or at or under the reorder level', () => {
    expect(isLowStock(-1, null)).toBe(true);
    expect(isLowStock(0, null)).toBe(false);
    expect(isLowStock(5_000, 5_000)).toBe(true);
    expect(isLowStock(5_001, 5_000)).toBe(false);
  });
});

describe('stockAlertText', () => {
  it('describes a delivery with the supplier and the new stock', () => {
    expect(stockAlertText(milk({ supplierName: 'Kamau' }))).toBe('40 L of fresh milk received from Kamau. Stock now 52 L.');
  });

  it('describes a write-off with its reason', () => {
    expect(stockAlertText(milk({ kind: 'spoilage', volume: 3_000, onHandAfter: 49_000, reason: 'power_outage' }))).toBe(
      '3 L of fresh milk written off (power outage). Stock now 49 L.',
    );
  });

  it('describes cancelled deliveries and write-offs', () => {
    expect(stockAlertText(milk({ reversal: true, volume: -40_000, onHandAfter: 12_000 }))).toBe(
      'A delivery of 40 L of fresh milk was cancelled. Stock now 12 L.',
    );
    expect(stockAlertText(milk({ kind: 'spoilage', reversal: true, volume: -3_000 }))).toBe(
      'A write-off of 3 L of fresh milk was cancelled. Stock now 52 L.',
    );
  });

  it('flags low stock after a delivery is cancelled', () => {
    expect(stockAlertText(milk({ reversal: true, volume: -40_000, onHandAfter: -2_000 }))).toContain('(running low)');
  });

  it('stays quiet for ordinary sales', () => {
    expect(stockAlertText(milk({ kind: 'sale', volume: 1_000, onHandAfter: 51_000 }))).toBeNull();
  });

  it('speaks up once when a sale takes a product to its reorder level', () => {
    const mala = { kind: 'sale' as const, itemName: 'Mala', unit: 'litre' as const, reorderLevel: 5_000 };
    expect(stockAlertText(milk({ ...mala, volume: 2_000, onHandAfter: 5_000 }))).toBe(
      'Mala is running low: 5 L left (reorder at 5 L).',
    );
    // Already low before this sale: no repeat.
    expect(stockAlertText(milk({ ...mala, volume: 1_000, onHandAfter: 4_000 }))).toBeNull();
  });

  it('warns when milk goes below zero', () => {
    expect(stockAlertText(milk({ kind: 'sale', volume: 3_000, onHandAfter: -1_000 }))).toBe(
      'Fresh milk stock is below zero (-1 L). A delivery may not have been recorded.',
    );
  });

  it('ignores cancelled sales', () => {
    expect(stockAlertText(milk({ kind: 'sale', reversal: true, volume: -1_000 }))).toBeNull();
  });
});
