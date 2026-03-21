import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import type { Stat } from '@/lib/types';
import { cn } from '@/lib/utils';
import * as icons from 'lucide-react';

export function MetricCard({
  icon,
  label,
  value,
  change,
  changeType,
}: Stat) {
  const Icon = icons[icon] as React.ElementType;
  if (!Icon) {
    return null; // Or return a default icon
  }
  return (
    <Card className="glass-card group">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">{label}</CardTitle>
        <div className="rounded-full bg-primary/10 p-2 text-primary dark:bg-primary/20 ring-1 ring-primary/20 group-hover:bg-primary group-hover:text-primary-foreground group-hover:scale-110 transition-all duration-300">
          <Icon className="h-4 w-4" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold font-headline">{value}</div>
        <p className={cn(
          "text-xs text-muted-foreground",
          changeType === 'increase' && 'text-green-700 dark:text-green-500',
          changeType === 'decrease' && 'text-destructive'
        )}>
          {change}
        </p>
      </CardContent>
    </Card>
  );
}
