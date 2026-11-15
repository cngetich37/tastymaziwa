import {
  BookOpen,
  Boxes,
  ChartColumn,
  ClipboardCheck,
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
  /** Who sees it. Defaults to owners only. */
  roles?: Role[];
}

/**
 * An ERP module (Sales, Purchasing, Inventory…). The sidebar lists modules
 * and their pages; inside a module, `ModuleTabs` shows its pages as tabs.
 */
export interface NavGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

const STAFF: Role[] = ['owner', 'attendant'];

export const TODAY: NavItem = { href: '/', label: 'Today', icon: LayoutDashboard, roles: STAFF };
export const SALES: NavItem = { href: '/sales', label: 'Sales', icon: ShoppingCart, roles: STAFF };
export const DELIVERIES: NavItem = { href: '/deliveries', label: 'Deliveries', icon: Truck, roles: STAFF };
export const CLOSE: NavItem = { href: '/close', label: 'Close shift', icon: ClipboardCheck, roles: STAFF };
export const CUSTOMERS: NavItem = { href: '/customers', label: 'Customers', icon: Users };
export const SUPPLIERS: NavItem = { href: '/suppliers', label: 'Suppliers', icon: Milk };
export const INVENTORY: NavItem = { href: '/inventory', label: 'Stock & products', icon: Boxes };
export const LEDGER: NavItem = { href: '/ledger', label: 'Ledger', icon: BookOpen };
export const REPORTS: NavItem = { href: '/reports', label: 'Reports', icon: ChartColumn };
export const SETTINGS: NavItem = { href: '/settings', label: 'Settings', icon: Settings };

/**
 * Owners get the whole business as modules; sellers get the counter only.
 * Pages are added here as modules ship (see docs/ROADMAP.md).
 */
const MODULES: NavGroup[] = [
  { id: 'home', label: 'Counter', icon: LayoutDashboard, items: [TODAY] },
  { id: 'sales', label: 'Sales', icon: ShoppingCart, items: [SALES, CUSTOMERS] },
  { id: 'purchasing', label: 'Purchasing', icon: Truck, items: [DELIVERIES, SUPPLIERS] },
  { id: 'inventory', label: 'Inventory', icon: Boxes, items: [INVENTORY] },
  { id: 'finance', label: 'Finance', icon: BookOpen, items: [LEDGER] },
  { id: 'insights', label: 'Insights', icon: ChartColumn, items: [REPORTS, SETTINGS] },
];

const canSee = (item: NavItem, role: Role) => (item.roles ?? ['owner']).includes(role);

export const navGroupsFor = (role: Role): NavGroup[] =>
  MODULES.map((g) => ({ ...g, items: g.items.filter((i) => canSee(i, role)) })).filter((g) => g.items.length > 0);

export const isActive = (pathname: string, href: string) =>
  href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

/** The module the current page belongs to (the longest matching link wins). */
export function moduleFor(pathname: string, role: Role): { group: NavGroup; active: NavItem } | null {
  let best: { group: NavGroup; active: NavItem } | null = null;
  for (const group of navGroupsFor(role)) {
    for (const item of group.items) {
      if (isActive(pathname, item.href) && (!best || item.href.length > best.active.href.length)) {
        best = { group, active: item };
      }
    }
  }
  return best;
}

/** Remembers the desktop sidebar's collapsed state, so the server renders it right first time. */
export const SIDEBAR_COOKIE = 'sidebar';

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';
