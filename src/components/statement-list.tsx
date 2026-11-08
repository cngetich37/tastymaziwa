import { formatShortDate } from '@/lib/dates';
import { formatKES, formatKESSigned, formatLitres } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { LedgerListItem } from '@/server/queries';

export type StatementLine = LedgerListItem & { effectCents: number; balanceCents: number };

const METHOD = { cash: 'cash', mpesa: 'M-Pesa', credit: 'on credit' } as const;

function describe(line: StatementLine): string {
  const reversal = line.reversesId ? 'Reversal · ' : '';
  const litres = line.volumeMl ? `${formatLitres(Math.abs(line.volumeMl))} @ ${formatKES(line.unitPriceCents ?? 0)}` : '';
  switch (line.kind) {
    case 'sale':
      return `${reversal}Bought ${litres}${line.paymentMethod ? `, ${METHOD[line.paymentMethod]}` : ''}`;
    case 'delivery':
      return `${reversal}Delivered ${litres}`;
    case 'customer_payment':
    case 'supplier_payment':
      return `${reversal}Payment${line.paymentMethod ? `, ${METHOD[line.paymentMethod]}` : ''}`;
    default:
      return reversal + line.kind;
  }
}

/**
 * An account statement, newest first: what happened, how it changed the
 * balance, and the balance after it.
 */
export function StatementList({ lines, balanceLabel }: { lines: StatementLine[]; balanceLabel: string }) {
  if (lines.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Nothing on this account yet.</p>;
  }
  return (
    <ul className="divide-y">
      {lines.map((line) => (
        <li key={line.id} className={cn('flex items-start gap-3 py-3', line.reversedById && 'opacity-60')}>
          <div className="min-w-0 flex-1">
            <p className={cn('text-sm font-medium', line.reversedById && 'line-through')}>{describe(line)}</p>
            <p className="text-xs text-muted-foreground">
              {formatShortDate(line.businessDate)}
              {line.note ? ` · ${line.note}` : ''}
            </p>
          </div>
          <div className="text-right">
            <p
              className={cn(
                'font-mono text-sm tabular-nums',
                line.effectCents > 0 && 'font-semibold',
                line.effectCents < 0 && 'text-green-700 dark:text-green-400',
                line.effectCents === 0 && 'text-muted-foreground',
              )}
            >
              {line.effectCents === 0 ? formatKES(Math.abs(line.amountCents)) : formatKESSigned(line.effectCents)}
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {balanceLabel} {formatKES(line.balanceCents)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
