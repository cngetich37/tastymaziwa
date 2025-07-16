import type { Stat, ProfitData, Transaction, CreditSale } from '@/lib/types';

// This file is now primarily for type definitions and can be used for data transformation functions
// if needed. The mock data has been moved to db.ts to be served via API routes.

export async function getDashboardData() {
  // This function is no longer the primary source of data for the dashboard.
  // The client-side context now fetches from the API routes.
  // We can leave this here for potential server-side rendering in the future or remove it.
  
  // For now, returning empty/default structures to avoid breaking anything that might still import it.
  return {
    stats: [],
    profitData: [],
    recentActivity: [],
    creditData: [],
  };
}
