'use client';

import React from 'react';
import type { Stat, ProfitData } from '@/lib/types';
import { MetricCard } from '@/components/metric-card';
import { ProfitChart } from '@/components/profit-chart';
import { RecentActivityTable } from '@/components/recent-activity-table';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { useData } from '@/context/data-context';
import { subDays, format, isToday } from 'date-fns';


export function DashboardClient() {
  const { recentActivity, creditData } = useData();

  // Filter for today's transactions
  const todayTransactions = recentActivity.filter(t => isToday(t.date));

  // Calculate stats for today
  const dailyRevenue = todayTransactions.filter(t => t.type === 'sale').reduce((sum, t) => sum + t.value, 0);
  const dailyCost = todayTransactions.filter(t => t.type === 'delivery' || t.type === 'payment').reduce((sum, t) => sum + t.value, 0);
  const dailyProfit = dailyRevenue + dailyCost;

  // Calculate cumulative stats
  const totalCredit = creditData.filter(c => c.status === 'outstanding').reduce((sum, c) => sum + c.amountOwed, 0);
  const totalOwed = recentActivity.filter(t => t.type === 'delivery').reduce((sum, t) => sum + t.value, 0);


  const stats: Stat[] = [
    { key: 'profit', label: 'Daily Profit', value: `KES ${dailyProfit.toLocaleString()}`, change: '+20.1%', changeType: 'increase', icon: 'TrendingUp' },
    { key: 'revenue', label: 'Daily Revenue', value: `KES ${dailyRevenue.toLocaleString()}`, change: '+15.2%', changeType: 'increase', icon: 'Banknote' },
    { key: 'credit', label: 'Outstanding Credit', value: `KES ${totalCredit.toLocaleString()}`, change: '-5.0%', changeType: 'decrease', icon: 'Users' },
    { key: 'owed', label: 'Owed to Milkman', value: `KES ${(-totalOwed).toLocaleString()}`, change: '+10%', changeType: 'increase', icon: 'Droplet' },
  ];

  // Calculate profit data for chart
  const profitData: ProfitData[] = Array.from({ length: 7 }, (_, i) => {
    const date = subDays(new Date(), 6 - i);
    const dateString = date.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' });
    
    const revenueForDay = recentActivity
      .filter(t => t.type === 'sale' && t.date.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' }) === dateString)
      .reduce((sum, t) => sum + t.value, 0);

    const costForDay = recentActivity
      .filter(t => (t.type === 'delivery' || t.type === 'payment') && t.date.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' }) === dateString)
      .reduce((sum, t) => sum + t.value, 0);
      
    return {
      date: format(date, 'MMM d'),
      profit: revenueForDay + costForDay,
    };
  });


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
                <CardDescription>Profit overview for the last 7 days ending {format(new Date(), 'PPP')}.</CardDescription>
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
