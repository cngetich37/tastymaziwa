'use client';

import React, { useEffect, useState } from 'react';
import type { Stat, ProfitData } from '@/lib/types';
import { MetricCard } from '@/components/metric-card';
import { ProfitChart } from '@/components/profit-chart';
import { RecentActivityTable } from '@/components/recent-activity-table';
import { CustomersTable } from '@/components/customers-table';
import { QuickActions } from '@/components/quick-actions';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { useData } from '@/context/data-context';
import { subDays, format, isToday, isSameDay } from 'date-fns';


export function DashboardClient() {
  const { recentActivity, creditData, subscriptions, stockData } = useData();
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);


  // Filter for today's transactions
  const todayTransactions = recentActivity.filter(t => isToday(new Date(t.date)));

  // Calculate stats for today
  const dailyRevenue = todayTransactions.filter(t => t.type === 'sale').reduce((sum, t) => sum + t.value, 0);
  const dailyCost = todayTransactions.filter(t => t.type === 'delivery' || t.type === 'payment').reduce((sum, t) => sum + t.value, 0);
  const dailyProfit = dailyRevenue + dailyCost;

  // Calculate cumulative stats
  const activeSubsCount = subscriptions.filter(s => s.status === 'active').length;
  
  // Basic stock calculation (Intake - Sales)
  const totalStockIntake = stockData.reduce((sum, s) => sum + s.intakeLiters, 0);
  const totalSalesLiters = recentActivity.filter(t => t.type === 'sale').reduce((sum, t) => sum + t.amount, 0);
  const currentStock = totalStockIntake - totalSalesLiters;

  const stats: Stat[] = [
    { key: 'profit', label: 'Daily Profit', value: `KES ${dailyProfit.toLocaleString()}`, change: '+20.1%', changeType: 'increase', icon: 'TrendingUp' },
    { key: 'revenue', label: 'Daily Revenue', value: `KES ${dailyRevenue.toLocaleString()}`, change: '+15.2%', changeType: 'increase', icon: 'Banknote' },
    { key: 'subs', label: 'Active Subscriptions', value: `${activeSubsCount}`, change: 'Recurring', icon: 'Users' },
    { key: 'stock', label: 'Current Stock', value: `${currentStock}L`, change: 'Available Liters', icon: 'Droplet' },
  ];

  // Calculate profit data for chart
  const profitData: ProfitData[] = Array.from({ length: 7 }, (_, i) => {
    const date = subDays(new Date(), 6 - i);
    
    const revenueForDay = recentActivity
      .filter(t => t.type === 'sale' && isSameDay(new Date(t.date), date))
      .reduce((sum, t) => sum + t.value, 0);

    const costForDay = recentActivity
      .filter(t => (t.type === 'delivery' || t.type === 'payment') && isSameDay(new Date(t.date), date))
      .reduce((sum, t) => sum + t.value, 0);
      
    return {
      date: format(date, 'MMM d'),
      profit: revenueForDay + costForDay,
    };
  });


  return (
    <div className="flex flex-col gap-6 w-full animate-in fade-in duration-700">
      <div className="flex flex-col gap-1 mb-2">
        <h2 className="text-3xl font-bold tracking-tight font-headline gradient-text w-fit">Dashboard Overview</h2>
        <p className="text-muted-foreground">Track your daily sales, credit, and profit.</p>
      </div>
      <QuickActions />
      <div className="grid gap-4 md:grid-cols-2 md:gap-8 lg:grid-cols-4">
        {stats.map(({ key, ...rest }, index) => (
          <div key={key} className="animate-in fade-in slide-in-from-bottom-4 duration-500" style={{ animationDelay: `${index * 100}ms`, animationFillMode: 'both' }}>
            <MetricCard {...rest} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:gap-8">
        <Card className="xl:col-span-2 glass-card overflow-hidden animate-in fade-in slide-in-from-bottom-8 duration-700" style={{ animationDelay: '150ms', animationFillMode: 'both' }}>
            <CardHeader className="bg-muted/30 border-b border-border/50">
                <CardTitle className="font-headline gradient-text inline-block w-fit">Weekly Profit</CardTitle>
                <CardDescription>Profit overview for the last 7 days ending {format(new Date(), 'PPP')}.</CardDescription>
            </CardHeader>
            <CardContent className="h-[300px] pt-6">
                {isClient && <ProfitChart data={profitData} />}
            </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 md:gap-8 lg:grid-cols-2">
        <CustomersTable />
        <RecentActivityTable transactions={recentActivity} />
      </div>
    </div>
  );
}
