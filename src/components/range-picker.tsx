import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { RANGE_PRESETS, type DateRange } from '@/lib/calc/reports';
import type { BusinessDate } from '@/lib/dates';
import { cn } from '@/lib/utils';

export const chipClass = (active: boolean) =>
  cn(
    'inline-flex h-11 items-center rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors',
    active ? 'border-primary bg-primary/10 text-primary' : 'border-input bg-background hover:bg-muted',
  );

/**
 * Preset periods as links plus a custom from/to GET form: works without
 * JavaScript. `keep` carries other query parameters (e.g. the report type).
 */
export function RangePicker({
  basePath,
  range,
  today,
  keep = {},
}: {
  basePath: string;
  range: DateRange;
  today: BusinessDate;
  keep?: Record<string, string>;
}) {
  const href = (params: Record<string, string>) => `${basePath}?${new URLSearchParams({ ...keep, ...params })}`;
  return (
    <section aria-label="Choose a period" className="grid gap-3 rounded-xl border bg-card p-4 print:hidden">
      <ul className="flex flex-wrap gap-2">
        {RANGE_PRESETS.map((p) => (
          <li key={p.value}>
            <Link
              href={href({ range: p.value })}
              aria-current={range.preset === p.value ? 'true' : undefined}
              className={chipClass(range.preset === p.value)}
            >
              {p.label}
            </Link>
          </li>
        ))}
      </ul>
      <form method="get" action={basePath} className="flex flex-wrap items-end gap-3">
        {Object.entries(keep).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label className="grid min-w-0 flex-1 gap-1 text-sm font-medium">
          From
          <input
            type="date"
            name="from"
            defaultValue={range.from}
            max={today}
            className="h-11 rounded-md border border-input bg-background px-3 text-base"
          />
        </label>
        <label className="grid min-w-0 flex-1 gap-1 text-sm font-medium">
          To
          <input
            type="date"
            name="to"
            defaultValue={range.to}
            max={today}
            className="h-11 rounded-md border border-input bg-background px-3 text-base"
          />
        </label>
        <Button type="submit" className="h-11 w-full sm:w-auto">
          Show
        </Button>
      </form>
    </section>
  );
}
