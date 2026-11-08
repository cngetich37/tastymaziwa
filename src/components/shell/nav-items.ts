import {
  BookOpen,
  LayoutDashboard,
  Milk,
  Settings,
  ShoppingCart,
  Truck,
  Users,
  type LucideIcon,
} from 'lucide-react';
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
export const SALES: NavItem = { href: '/sales', label: 'Sales', icon: ShoppingCart };
export const DELIVERIES: NavItem = { href: '/deliveries', label: 'Deliveries', icon: Truck };
export const CUSTOMERS: NavItem = { href: '/customers', label: 'Customers', icon: Users, ownerOnly: true };
export const SUPPLIERS: NavItem = { href: '/suppliers', label: 'Suppliers', icon: Milk, ownerOnly: true };
export const LEDGER: NavItem = { href: '/ledger', label: 'Ledger', icon: BookOpen, ownerOnly: true };
export const SETTINGS: NavItem = { href: '/settings', label: 'Settings', icon: Settings, ownerOnly: true };

/**
 * Follows the shop's day: what happens at the counter, who the shop trades
 * with, then the books. Attendants only see the counter.
 */
const NAV_GROUPS: NavGroup[] = [
  { label: 'Counter', items: [TODAY, SALES, DELIVERIES] },
  { label: 'People', items: [CUSTOMERS, SUPPLIERS] },
  { label: 'Books', items: [LEDGER, SETTINGS] },
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
