'use client';

import { useEntryData } from '@/components/shell/entry-data';
import { actionsFor, RecordDialog, type EntryAction } from '@/components/shell/record-dialog';
import { cn } from '@/lib/utils';

function ActionTile({ action, primary, wide, ...props }: { action: EntryAction; primary: boolean; wide: boolean }) {
  const Icon = action.icon;
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'flex min-h-24 flex-col items-start justify-between gap-2 rounded-xl border p-4 text-left shadow-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
        wide && 'col-span-2 sm:col-span-1',
        primary
          ? 'min-h-16 flex-row items-center justify-start gap-3 border-primary bg-primary text-primary-foreground hover:bg-primary/90 sm:min-h-24 sm:flex-col sm:items-start sm:justify-between'
          : 'bg-card hover:border-primary hover:bg-primary/5',
      )}
    >
      <Icon className={cn('size-6', !primary && 'text-primary')} aria-hidden />
      <span className="text-base font-semibold">{action.label}</span>
    </button>
  );
}

/**
 * The counter actions, one tap from Today. Sale, the most common, stands out.
 * Attendants get Sale and Delivery; owners also Payment in and Spoilage.
 */
export function QuickActions() {
  const { isOwner } = useEntryData();
  const actions = actionsFor(isOwner).slice(0, 4);
  return (
    <div className={cn('grid grid-cols-2 gap-3', actions.length > 2 && 'sm:grid-cols-4')}>
      {actions.map((action, i) => (
        <RecordDialog
          key={action.kind}
          initial={action.kind}
          trigger={<ActionTile action={action} primary={i === 0} wide={i === 0 || actions.length === 2} />}
        />
      ))}
    </div>
  );
}
