'use client';

import { createContext, use, type ReactNode } from 'react';
import type { CustomerOption, SupplierOption } from '@/components/forms/entry-forms';

/**
 * What the entry forms need (customer and supplier pickers, the usual price).
 * The app layout loads it once, so the Record button works on every page;
 * every server action revalidates the layout, so it stays current.
 */
export interface EntryData {
  customers: CustomerOption[];
  suppliers: SupplierOption[];
  /** The owner's selling price; null until it is set in Settings. */
  salePriceCents: number | null;
  isOwner: boolean;
}

const EntryDataContext = createContext<EntryData | null>(null);

export function EntryDataProvider({ value, children }: { value: EntryData; children: ReactNode }) {
  return <EntryDataContext value={value}>{children}</EntryDataContext>;
}

export function useEntryData(): EntryData {
  const data = use(EntryDataContext);
  if (!data) throw new Error('useEntryData must be used inside <EntryDataProvider>');
  return data;
}
