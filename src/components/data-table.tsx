import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  /** The row's title on phones (one column should set it). */
  primary?: boolean;
  /** Left out of the phone card (secondary detail). */
  hideOnMobile?: boolean;
}

/**
 * An ERP list: a proper table from tablet width up, and on phones a stack of
 * cards (title + label/value pairs), so a 360px screen never scrolls sideways.
 * Rows can link to a detail page. Server component: no client JS.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowHref,
  empty = 'Nothing here yet.',
  footer,
  label,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string | null;
  empty?: ReactNode;
  /** A totals row: cells keyed like the columns. */
  footer?: Partial<Record<string, ReactNode>>;
  /** Accessible name for the table. */
  label: string;
}) {
  if (rows.length === 0) {
    return <div className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">{empty}</div>;
  }
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const details = columns.filter((c) => c !== primary && !c.hideOnMobile);

  return (
    <>
      {/* Phones: cards */}
      <ul aria-label={label} className="grid gap-2 sm:hidden">
        {rows.map((row) => {
          const href = rowHref?.(row);
          const body = (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 font-semibold">{primary.cell(row)}</div>
                {href && <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
              </div>
              {details.length > 0 && (
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                  {details.map((c) => (
                    <div key={c.key} className="min-w-0">
                      <dt className="text-xs text-muted-foreground">{c.header}</dt>
                      <dd className="truncate">{c.cell(row)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          );
          return (
            <li key={rowKey(row)}>
              {href ? (
                <Link href={href} className="block rounded-lg border bg-card p-3 transition-colors hover:border-primary/50 active:bg-muted">
                  {body}
                </Link>
              ) : (
                <div className="rounded-lg border bg-card p-3">{body}</div>
              )}
            </li>
          );
        })}
        {footer && (
          <li className="rounded-lg bg-muted p-3 text-sm font-semibold">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {columns
                .filter((c) => footer[c.key] != null)
                .map((c) => (
                  <div key={c.key}>
                    <dt className="text-xs font-normal text-muted-foreground">{c === primary ? '' : c.header}</dt>
                    <dd>{footer[c.key]}</dd>
                  </div>
                ))}
            </dl>
          </li>
        )}
      </ul>

      {/* Tablet and up: a table */}
      <div className="hidden overflow-x-auto rounded-lg border sm:block">
        <table aria-label={label} className="w-full text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn('h-10 px-3 font-medium whitespace-nowrap', c.align === 'right' ? 'text-right' : 'text-left')}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => {
              const href = rowHref?.(row);
              return (
                <tr key={rowKey(row)} className={cn('bg-card', href && 'transition-colors hover:bg-muted/50')}>
                  {columns.map((c) => (
                    <td key={c.key} className={cn('px-3 py-2.5', c.align === 'right' && 'text-right whitespace-nowrap')}>
                      {href && c === primary ? (
                        <Link href={href} className="font-medium text-foreground hover:text-primary hover:underline">
                          {c.cell(row)}
                        </Link>
                      ) : (
                        c.cell(row)
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          {footer && (
            <tfoot className="border-t-2 bg-muted/40 font-semibold">
              <tr>
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-3 py-2.5', c.align === 'right' && 'text-right whitespace-nowrap')}>
                    {footer[c.key]}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}
