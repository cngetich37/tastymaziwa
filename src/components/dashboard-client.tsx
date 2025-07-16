'use client';

import React, { useState } from 'react';
import type { Stat, ProfitData, Transaction, CreditSale } from '@/lib/types';
import { MetricCard } from '@/components/metric-card';
import { ProfitChart } from '@/components/profit-chart';
import { RecentActivityTable } from '@/components/recent-activity-table';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';

interface DashboardClientProps {
  initialStats: Stat[];
  initialProfitData: ProfitData[];
  initialRecentActivity: Transaction[];
}

export function DashboardClient({
  initialStats,
  initialProfitData,
  initialRecentActivity,
}: DashboardClientProps) {
  const [stats, setStats] = useState<Stat[]>(initialStats);
  const [profitData, setProfitData] = useState<ProfitData[]>(initialProfitData);
  const [recentActivity, setRecentActivity] = useState<Transaction[]>(initialRecentActivity);

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 md:gap-8 lg:grid-cols-4">
        {stats.map(({ key, ...rest }) => (
          <MetricCard key={key} {...rest} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:gap-8">
        <Card className="xl:col-span-2">
            <CardHeader>
                <CardTitle className="font-headline">Weekly Profit</CardTitle>
                <CardDescription>Your profit overview for the last 7 days.</CardDescription>
            </CardHeader>
            <CardContent>
                <ProfitChart data={profitData} />
            </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 md:gap-8 lg:grid-cols-1">
        <RecentActivityTable transactions={recentActivity} />
      </div>
    </>
  );
}
