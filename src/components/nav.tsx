'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, HandCoins, LayoutDashboard, Settings, type LucideIcon } from 'lucide-react';
import type { Role } from '@/db/schema';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  ownerOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Today', icon: LayoutDashboard },
  { href: '/ledger', label: 'Ledger', icon: BookOpen },
  { href: '/credit', label: 'Credit', icon: HandCoins },
  { href: '/settings', label: 'Settings', icon: Settings, ownerOnly: true },
];

const itemsFor = (role: Role) => NAV_ITEMS.filter((i) => !i.ownerOnly || role === 'owner');

const isActive = (pathname: string, href: string) =>
  href === '/' ? pathname === '/' : pathname.startsWith(href);

/** Inline links in the header (tablet and up). */
export function DesktopNav({ role }: { role: Role }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="ml-6 hidden items-center gap-6 md:flex">
      {itemsFor(role).map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={isActive(pathname, item.href) ? 'page' : undefined}
          className={cn(
            'text-sm font-medium transition-colors hover:text-primary',
            isActive(pathname, item.href) ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/** Thumb-reachable tab bar (phones). */
export function MobileNav({ role }: { role: Role }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid auto-cols-fr grid-flow-col">
        {itemsFor(role).map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
