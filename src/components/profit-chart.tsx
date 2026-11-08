'use client';

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatShortDate } from '@/lib/dates';
import { formatKES } from '@/lib/money';
import type { DailyPoint } from '@/lib/calc/summary';

const compactKES = new Intl.NumberFormat('en-KE', { notation: 'compact', maximumFractionDigits: 1 });

export function ProfitChart({ data }: { data: DailyPoint[] }) {
  const rows = data.map((d) => ({ label: formatShortDate(d.date), profit: d.netProfitCents / 100 }));
  return (
    <div className="h-56 w-full" role="img" aria-label="Net profit per day for the last 7 days">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--color-border)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} stroke="var(--color-muted-foreground)" />
          <YAxis
            tickLine={false}
            axisLine={false}
            fontSize={12}
            width={48}
            stroke="var(--color-muted-foreground)"
            tickFormatter={(v: number) => compactKES.format(v)}
          />
          <Tooltip
            cursor={{ fill: 'var(--color-muted)' }}
            contentStyle={{
              background: 'var(--color-popover)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              color: 'var(--color-popover-foreground)',
            }}
            formatter={(value) => [formatKES(Math.round(Number(value) * 100)), 'Net profit']}
          />
          <Bar dataKey="profit" radius={[4, 4, 0, 0]}>
            {rows.map((r) => (
              <Cell key={r.label} fill={r.profit < 0 ? 'var(--color-red-500, #ef4444)' : 'var(--color-primary)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
