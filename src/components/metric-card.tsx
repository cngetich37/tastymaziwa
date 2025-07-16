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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        <Icon className="h-5 w-5 text-muted-foreground" />
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
