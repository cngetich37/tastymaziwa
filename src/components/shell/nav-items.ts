import { BookOpen, HandCoins, LayoutDashboard, Settings, type LucideIcon } from 'lucide-react';
import type { Role } from '@/db/schema';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  ownerOnly?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const TODAY: NavItem = { href: '/', label: 'Today', icon: LayoutDashboard };
export const LEDGER: NavItem = { href: '/ledger', label: 'Ledger', icon: BookOpen };
export const CREDIT: NavItem = { href: '/credit', label: 'Credit', icon: HandCoins };
export const SETTINGS: NavItem = { href: '/settings', label: 'Settings', icon: Settings, ownerOnly: true };

const NAV_GROUPS: NavGroup[] = [
  { label: 'Shop', items: [TODAY, LEDGER, CREDIT] },
  { label: 'Manage', items: [SETTINGS] },
];

export const navGroupsFor = (role: Role): NavGroup[] =>
  NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !i.ownerOnly || role === 'owner') })).filter(
    (g) => g.items.length > 0,
  );

export const isActive = (pathname: string, href: string) =>
  href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

/** Remembers the desktop sidebar's collapsed state, so the server renders it right first time. */
export const SIDEBAR_COOKIE = 'sidebar';

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';
