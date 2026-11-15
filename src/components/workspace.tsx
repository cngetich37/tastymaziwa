import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import { navGroupsFor } from '@/components/shell/nav-items';
import type { Role } from '@/db/schema';
import { cn } from '@/lib/utils';

export interface AttentionItem {
  href: string;
  icon: LucideIcon;
  text: string;
  detail?: string;
  tone: 'warning' | 'danger';
}

/**
 * Everything waiting on the owner, in one place, each one tap from the fix.
 * Renders an all-clear line when there is nothing to do.
 */
export function NeedsAttention({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
        Nothing needs your attention. 👍
      </p>
    );
  }
  return (
    <section aria-label="Needs your attention" className="grid gap-2">
      <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Needs your attention</h2>
      <ul className="grid gap-2 md:grid-cols-2">
        {items.map((item) => (
          <li key={item.href + item.text}>
            <Link
              href={item.href}
              className={cn(
                'flex min-h-14 items-center gap-3 rounded-lg border px-4 py-2 text-sm transition-colors',
                item.tone === 'danger'
                  ? 'border-red-500/40 bg-red-500/5 hover:bg-red-500/10'
                  : 'border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10',
              )}
            >
              <item.icon
                className={cn(
                  'size-5 shrink-0',
                  item.tone === 'danger' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400',
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{item.text}</span>
                {item.detail && <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Phones: the modules as big tiles, so nothing is buried in a menu. */
export function ModuleLauncher({ role }: { role: Role }) {
  const modules = navGroupsFor(role).filter((g) => g.id !== 'home');
  return (
    <nav aria-label="Modules" className="md:hidden">
      <ul className="grid grid-cols-3 gap-2">
        {modules.map((m) => (
          <li key={m.id}>
            <Link
              href={m.items[0].href}
              className="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl border bg-card p-2 text-center text-xs font-medium transition-colors hover:border-primary/50 active:bg-muted"
            >
              <span className="rounded-lg bg-primary/10 p-2 text-primary">
                <m.icon className="size-5" aria-hidden />
              </span>
              {m.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
