/**
 * Who does what. Isomorphic: used by pages, actions and the UI.
 *
 * - owner: the shop's admin. Oversight: prices, people, reports, corrections.
 * - attendant: the milk seller at the counter. Records sales and approves
 *   (or rejects) the deliveries suppliers record.
 * - supplier: a milkman's own login. Records what they delivered, nothing else.
 */
import type { Role } from '@/db/schema';

/** People who work in the shop (everything under the main app shell). */
export const STAFF: Role[] = ['owner', 'attendant'];
export const OWNER: Role[] = ['owner'];
export const SUPPLIER: Role[] = ['supplier'];
export const ALL_ROLES: Role[] = ['owner', 'attendant', 'supplier'];

/** Where a role lands after sign-in, or when it opens a page it can't use. */
export const homeFor = (role: Role) => (role === 'supplier' ? '/supply' : '/');

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  attendant: 'Seller',
  supplier: 'Supplier',
};
