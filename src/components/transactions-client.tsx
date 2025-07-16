'use client';

import { DataEntryTabs } from './data-entry-tabs';
import { RecentActivityTable } from './recent-activity-table';
import { useData } from '@/context/data-context';


export function TransactionsClient() {
  const { recentActivity, addTransaction, addCreditSale } = useData();

  return (
    <div className="grid grid-cols-1 gap-4 md:gap-8 xl:grid-cols-3">
        <div className="xl:col-span-1">
            <DataEntryTabs onNewTransaction={addTransaction} onNewCreditSale={addCreditSale} />
        </div>
        <div className="xl:col-span-2">
            <RecentActivityTable transactions={recentActivity} />
        </div>
    </div>
  );
}
