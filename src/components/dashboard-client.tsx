'use client';

import React, { useState } from 'react';
import type { Stat, ProfitData, Transaction, CreditSale } from '@/lib/types';
import { MetricCard } from '@/components/metric-card';
import { ProfitChart } from '@/components/profit-chart';
import { RecentActivityTable } from '@/components/recent-activity-table';
import { CreditTable } from '@/components/credit-table';
import { DataEntryTabs } from '@/components/data-entry-tabs';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';

interface DashboardClientProps {
  initialStats: Stat[];
  initialProfitData: ProfitData[];
  initialRecentActivity: Transaction[];
  initialCreditData: CreditSale[];
}

export function DashboardClient({
  initialStats,
  initialProfitData,
  initialRecentActivity,
  initialCreditData,
}: DashboardClientProps) {
  const [stats, setStats] = useState<Stat[]>(initialStats);
  const [profitData, setProfitData] = useState<ProfitData[]>(initialProfitData);
  const [recentActivity, setRecentActivity] = useState<Transaction[]>(initialRecentActivity);
  const [creditData, setCreditData] = useState<CreditSale[]>(initialCreditData);

  // In a real app, these handlers would call an API
  // For now, they'll just update local state to demonstrate interactivity
  const handleNewTransaction = (newTx: Omit<Transaction, 'id'>) => {
    const txWithId = { ...newTx, id: new Date().toISOString() };
    setRecentActivity(prev => [txWithId, ...prev].sort((a,b) => b.date.getTime() - a.date.getTime()));
    // Here you would also recalculate stats and update them
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
    <>
      <div className="grid gap-4 md:grid-cols-2 md:gap-8 lg:grid-cols-4">
        {stats.map(({ key, ...rest }) => (
          <MetricCard key={key} {...rest} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:gap-8 xl:grid-cols-3">
        <Card className="xl:col-span-2">
            <CardHeader>
                <CardTitle className="font-headline">Weekly Profit</CardTitle>
                <CardDescription>Your profit overview for the last 7 days.</CardDescription>
            </CardHeader>
            <CardContent>
                <ProfitChart data={profitData} />
            </CardContent>
        </Card>
        <div className="xl:col-span-1">
          <DataEntryTabs onNewTransaction={handleNewTransaction} onNewCreditSale={handleNewCreditSale} />
        </div>
      </div>
      <div className="grid gap-4 md:gap-8 lg:grid-cols-2">
        <RecentActivityTable transactions={recentActivity} />
        <CreditTable creditSales={creditData} />
      </div>
    </>
  );
}
