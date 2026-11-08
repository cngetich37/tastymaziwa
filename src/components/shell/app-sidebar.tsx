'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { LogOut, PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react';
import { Logo } from '@/components/logo';
import { ThemeSwitcher, ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import type { Role } from '@/db/schema';
import { cn } from '@/lib/utils';
import { SIDEBAR_COOKIE, initials, isActive, navGroupsFor } from './nav-items';
import { RecordDialog } from './record-dialog';

export interface ShellUser {
  name: string;
  role: Role;
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

const rowClass = (active: boolean, collapsed: boolean) =>
  cn(
    'flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
    active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    collapsed && 'justify-center px-0',
  );

/**
 * The sidebar's contents: shop, Record button, navigation, theme and account.
 * Shared by the desktop sidebar and the phone's slide-out menu.
 */
export function SidebarBody({
  user,
  shopName,
  collapsed = false,
  onToggle,
  onNavigate,
  showRecord = true,
}: {
  user: ShellUser;
  shopName: string;
  collapsed?: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
  showRecord?: boolean;
}) {
  const pathname = usePathname();
  const label = (text: string) => <span className={cn('truncate', collapsed && 'sr-only')}>{text}</span>;

  return (
    <div className="flex h-full flex-col">
      <Link
        href="/"
        onClick={onNavigate}
        className={cn('flex h-16 shrink-0 items-center gap-2 border-b px-4', collapsed && 'justify-center px-0')}
        title={collapsed ? shopName : undefined}
      >
        <Logo />
        <span className={cn('min-w-0', collapsed && 'sr-only')}>
          <span className="block truncate font-bold leading-tight tracking-tight">{shopName}</span>
          <span className="block text-xs text-muted-foreground">TastyMaziwa</span>
        </span>
      </Link>

      {showRecord && (
        <div className={cn('p-3', collapsed && 'px-2')}>
          <RecordDialog
            trigger={
              <Button className={cn('h-11 w-full gap-2 text-base', collapsed && 'px-0')} title="Record a sale, delivery or payment">
                <Plus className="size-5" aria-hidden />
                {label('Record')}
              </Button>
            }
          />
        </div>
      )}

      <nav aria-label="Main" className={cn('flex-1 overflow-y-auto px-3 py-2', collapsed && 'px-2')}>
        {navGroupsFor(user.role).map((group) => (
          <div key={group.label} className="mb-4">
            <p
              className={cn(
                'px-3 pb-1 text-xs font-semibold tracking-wider text-muted-foreground/80 uppercase',
                collapsed && 'sr-only',
              )}
            >
              {group.label}
            </p>
            <ul className="grid gap-1">
              {group.items.map(({ href, label: text, icon: Icon }) => {
                const active = isActive(pathname, href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      title={collapsed ? text : undefined}
                      className={rowClass(active, collapsed)}
                    >
                      <Icon className="size-5 shrink-0" aria-hidden />
                      {label(text)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className={cn('grid gap-1 border-t p-3', collapsed && 'px-2')}>
        {collapsed ? <ThemeToggle className="mx-auto mb-1 size-11" /> : <div className="mb-2"><ThemeSwitcher /></div>}
        <Link
          href="/account"
          onClick={onNavigate}
          aria-current={isActive(pathname, '/account') ? 'page' : undefined}
          title={collapsed ? 'Your account' : undefined}
          className={cn(rowClass(isActive(pathname, '/account'), collapsed), 'h-14')}
        >
          <Avatar name={user.name} />
          <span className={cn('min-w-0 text-left', collapsed && 'sr-only')}>
            <span className="block truncate font-semibold text-foreground">{user.name}</span>
            <span className="block text-xs capitalize text-muted-foreground">{user.role} · Account</span>
          </span>
        </Link>
        <button
          type="button"
          onClick={() => signOut({ redirectTo: '/login' })}
          title={collapsed ? 'Sign out' : undefined}
          className={rowClass(false, collapsed)}
        >
          <LogOut className="size-5 shrink-0" aria-hidden />
          {label('Sign out')}
        </button>
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            title={`${collapsed ? 'Expand' : 'Collapse'} sidebar (Ctrl+B)`}
            className={rowClass(false, collapsed)}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-5 shrink-0" aria-hidden />
            ) : (
              <PanelLeftClose className="size-5 shrink-0" aria-hidden />
            )}
            {label(collapsed ? 'Expand sidebar' : 'Collapse sidebar')}
          </button>
        )}
      </div>
    </div>
  );
}

/** Fixed left sidebar from tablet width up; collapses to an icon rail. */
export function DesktopSidebar({
  user,
  shopName,
  defaultCollapsed,
}: {
  user: ShellUser;
  shopName: string;
  defaultCollapsed: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const toggle = useCallback(() => {
    setCollapsed((was) => {
      const next = !was;
      document.cookie = `${SIDEBAR_COOKIE}=${next ? 'collapsed' : 'expanded'}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'b' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 border-r bg-card transition-[width] duration-200 md:block',
        collapsed ? 'w-[4.5rem]' : 'w-64',
      )}
    >
      <SidebarBody user={user} shopName={shopName} collapsed={collapsed} onToggle={toggle} />
    </aside>
  );
}
