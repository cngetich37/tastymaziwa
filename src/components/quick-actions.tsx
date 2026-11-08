'use client';

import { actionsFor, RecordDialog, type EntryAction } from '@/components/shell/record-dialog';
import { cn } from '@/lib/utils';

function ActionTile({ action, primary, ...props }: { action: EntryAction; primary: boolean }) {
  const Icon = action.icon;
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'flex min-h-24 flex-col items-start justify-between gap-2 rounded-xl border p-4 text-left shadow-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
        primary
          ? 'col-span-2 min-h-16 flex-row items-center justify-start gap-3 border-primary bg-primary text-primary-foreground hover:bg-primary/90 sm:col-span-1 sm:min-h-24 sm:flex-col sm:items-start sm:justify-between'
          : 'bg-card hover:border-primary hover:bg-primary/5',
      )}
    >
      <Icon className={cn('size-6', !primary && 'text-primary')} aria-hidden />
      <span className="text-base font-semibold">{action.label}</span>
    </button>
  );
}

/** The four counter actions, one tap from Today. Sale, the most common, stands out. */
export function QuickActions() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {actionsFor(false).map((action, i) => (
        <RecordDialog
          key={action.kind}
          initial={action.kind}
          trigger={<ActionTile action={action} primary={i === 0} />}
        />
      ))}
    </div>
  );
}
