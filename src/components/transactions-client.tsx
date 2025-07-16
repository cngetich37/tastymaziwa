'use client';

import { useState } from 'react';
import type { CreditSale, Transaction } from '@/lib/types';
import { DataEntryTabs } from './data-entry-tabs';
import { RecentActivityTable } from './recent-activity-table';

interface TransactionsClientProps {
  initialRecentActivity: Transaction[];
  initialCreditData: CreditSale[]; // Keep this to simulate creating new credit sales
}

export function TransactionsClient({ initialRecentActivity, initialCreditData }: TransactionsClientProps) {
  const [recentActivity, setRecentActivity] = useState<Transaction[]>(initialRecentActivity);
  const [creditData, setCreditData] = useState<CreditSale[]>(initialCreditData);

  const handleNewTransaction = (newTx: Omit<Transaction, 'id'>) => {
    const txWithId = { ...newTx, id: new Date().toISOString() };
    setRecentActivity(prev => [txWithId, ...prev].sort((a,b) => b.date.getTime() - a.date.getTime()));
  };

  const handleNewCreditSale = (newSale: Omit<CreditSale, 'id' | 'amountOwed' | 'status'>) => {
    const saleWithId: CreditSale = { 
      ...newSale, 
      id: new Date().toISOString(),
      amountOwed: newSale.liters * newSale.pricePerLiter,
      status: 'outstanding'
    };
    setCreditData(prev => [saleWithId, ...prev]);
    handleNewTransaction({
      type: 'sale',
      date: newSale.saleDate,
      description: `Credit to ${newSale.customerName}`,
      amount: newSale.liters,
      value: saleWithId.amountOwed
    });
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:gap-8 xl:grid-cols-3">
        <div className="xl:col-span-1">
            <DataEntryTabs onNewTransaction={handleNewTransaction} onNewCreditSale={handleNewCreditSale} />
        </div>
        <div className="xl:col-span-2">
            <RecentActivityTable transactions={recentActivity} />
        </div>
    </div>
  );
}
