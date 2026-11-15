import 'server-only';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import type { Role } from '@/db/schema';
import { STAFF, homeFor } from '@/lib/roles';
import type { Actor } from './ledger';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  shopId: string;
}

/** The signed-in user, or null. */
export async function currentUser(): Promise<SessionUser | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.role || !user.shopId) return null;
  return {
    id: user.id,
    name: user.name ?? 'User',
    email: user.email ?? '',
    role: user.role,
    shopId: user.shopId,
  };
}

/**
 * For pages: redirect to /login, or to the role's own home if this page
 * isn't for it. Defaults to shop staff, so a supplier login can never open
 * a shop page by accident; supplier pages pass `SUPPLIER` explicitly.
 */
export async function requireUser(roles: Role[] = STAFF): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!roles.includes(user.role)) redirect(homeFor(user.role));
  return user;
}

export const toActor = (user: SessionUser): Actor => ({ id: user.id, role: user.role, shopId: user.shopId });
