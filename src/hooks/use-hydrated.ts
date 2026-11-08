'use client';

import { useSyncExternalStore } from 'react';

const noopSubscribe = () => () => {};

/** False during server render and hydration, true once React owns the page. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}
