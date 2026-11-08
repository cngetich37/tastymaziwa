import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = 'default',
}: {
  label: string;
  value: string;
  detail?: ReactNode;
  icon: LucideIcon;
  tone?: 'default' | 'positive' | 'negative' | 'warning';
}) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p
            className={cn(
              'mt-1 truncate text-2xl font-bold tabular-nums',
              tone === 'positive' && 'text-green-700 dark:text-green-400',
              tone === 'negative' && 'text-red-600 dark:text-red-400',
              tone === 'warning' && 'text-amber-600 dark:text-amber-400',
            )}
          >
            {value}
          </p>
          {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
        </div>
        <div className="rounded-full bg-primary/10 p-2 text-primary">
          <Icon className="h-5 w-5" aria-hidden />
        </div>
      </CardContent>
    </Card>
  );
}
