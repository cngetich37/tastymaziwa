'use client';

import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import type { ProfitData } from '@/lib/types';
import { useEffect, useState } from 'react';

interface ProfitChartProps {
  data: ProfitData[];
}

export function ProfitChart({ data }: ProfitChartProps) {
    const [isClient, setIsClient] = useState(false);

    useEffect(() => {
        setIsClient(true);
    }, []);

    if (!isClient) {
        return null; // Or a loading skeleton
    }
    
  return (
    <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                <XAxis
                    dataKey="date"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                />
                <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `KES ${value/1000}k`}
                />
                <Tooltip
                    contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 'var(--radius)',
                        color: 'hsl(var(--card-foreground))'
                    }}
                    labelStyle={{ fontWeight: 'bold' }}
                    itemStyle={{ color: 'hsl(var(--chart-4))' }}
                    formatter={(value: number) => [`KES ${value.toLocaleString()}`, 'Profit']}
                    cursor={{ fill: 'hsl(var(--primary) / 0.1)' }}
                />
                <Bar dataKey="profit" fill="hsl(var(--chart-4))" radius={[4, 4, 0, 0]} />
            </BarChart>
        </ResponsiveContainer>
    </div>
  );
}
