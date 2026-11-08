'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, Plus } from 'lucide-react';
import { Logo } from '@/components/logo';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { Avatar, SidebarBody, type ShellUser } from './app-sidebar';
import { CREDIT, LEDGER, TODAY, isActive, type NavItem } from './nav-items';
import { RecordDialog } from './record-dialog';

/** Slim top bar on phones: which shop you're in, and your account. */
export function MobileHeader({ user, shopName }: { user: ShellUser; shopName: string }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur md:hidden">
      <Link href="/" className="flex min-w-0 items-center gap-2">
        <Logo />
        <span className="truncate text-lg font-bold tracking-tight">{shopName}</span>
      </Link>
      <Link href="/account" aria-label="Your account" className="ml-auto flex size-11 items-center justify-center">
        <Avatar name={user.name} className="size-8 text-xs" />
      </Link>
    </header>
  );
}

const tabClass = (active: boolean) =>
  cn(
    'flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium',
    active ? 'text-primary' : 'text-muted-foreground',
  );

function Tab({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(pathname, item.href);
  return (
    <li>
      <Link href={item.href} aria-current={active ? 'page' : undefined} className={tabClass(active)}>
        <span className={cn('rounded-full px-4 py-1 transition-colors', active && 'bg-primary/15')}>
          <item.icon className="size-5" aria-hidden />
        </span>
        {item.label}
      </Link>
    </li>
  );
}

/**
 * Thumb-reach tab bar on phones: the three daily pages, a raised Record button
 * in the middle, and Menu, which slides out the full sidebar.
 */
export function MobileTabBar({ user, shopName }: { user: ShellUser; shopName: string }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav
      aria-label="Quick"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid grid-cols-5 items-end">
        <Tab item={TODAY} pathname={pathname} />
        <Tab item={LEDGER} pathname={pathname} />
        <li className="flex justify-center">
          <RecordDialog
            trigger={
              <button type="button" className="flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-primary">
                <span className="-mt-6 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background">
                  <Plus className="size-6" aria-hidden />
                </span>
                Record
              </button>
            }
          />
        </li>
        <Tab item={CREDIT} pathname={pathname} />
        <li>
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <button type="button" className={tabClass(false)}>
                <span className="px-4 py-1">
                  <Menu className="size-5" aria-hidden />
                </span>
                Menu
              </button>
            </SheetTrigger>
            <SheetContent side="left" aria-describedby={undefined} className="w-72 p-0 pb-[env(safe-area-inset-bottom)]">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <SidebarBody
                user={user}
                shopName={shopName}
                showRecord={false}
                onNavigate={() => setMenuOpen(false)}
              />
            </SheetContent>
          </Sheet>
        </li>
      </ul>
    </nav>
  );
}
