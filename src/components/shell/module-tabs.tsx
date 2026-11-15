'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Role } from '@/db/schema';
import { cn } from '@/lib/utils';
import { moduleFor } from './nav-items';

/**
 * The current module's pages as tabs (e.g. Sales · Customers), so related
 * screens are one tap apart on a phone as well as on a desktop. Hidden for
 * modules with a single page.
 */
export function ModuleTabs({ role }: { role: Role }) {
  const pathname = usePathname();
  const found = moduleFor(pathname, role);
  if (!found || found.group.items.length < 2) return null;
  const { group, active } = found;
  return (
    <nav aria-label={`${group.label} pages`} className="-mx-4 mb-5 border-b px-4 md:mx-0 md:mb-6 md:px-0 print:hidden">
      <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        <group.icon className="size-3.5" aria-hidden />
        {group.label}
      </p>
      <ul className="-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none]">
        {group.items.map((item) => {
          const current = item.href === active.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'flex h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors',
                  current
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
                )}
              >
                <item.icon className="size-4" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
