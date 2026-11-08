import { and, asc, eq } from 'drizzle-orm';
import type { DB } from '@/db/client';
import { auditLog, shops, users } from '@/db/schema';
import { hashPassword } from './password';

export function listUsers(db: DB, shopId: string) {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      active: users.active,
      emailVerifiedAt: users.emailVerifiedAt,
      hasPassword: users.passwordHash,
    })
    .from(users)
    .where(eq(users.shopId, shopId))
    .orderBy(asc(users.name))
    .then((rows) => rows.map(({ hasPassword, ...u }) => ({ ...u, hasPassword: hasPassword != null })));
}

export async function getUser(db: DB, shopId: string, userId: string) {
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, hasPassword: users.passwordHash })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.shopId, shopId)));
  return user ? { ...user, hasPassword: user.hasPassword != null } : null;
}

/**
 * Create a shop and its verified owner directly (seed script / operators).
 * Public sign-up does the same thing via completeSignup() after email proof.
 */
export async function createShopWithOwner(
  db: DB,
  input: { shopName: string; name: string; email: string; password: string },
) {
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const [shop] = await tx.insert(shops).values({ name: input.shopName }).returning();
    const [owner] = await tx
      .insert(users)
      .values({
        shopId: shop.id,
        name: input.name,
        email: input.email.toLowerCase(),
        emailVerifiedAt: new Date(),
        passwordHash,
        role: 'owner',
      })
      .returning({ id: users.id, email: users.email });
    await tx.insert(auditLog).values({
      shopId: shop.id,
      userId: owner.id,
      action: 'shop.create',
      entityType: 'shop',
      entityId: shop.id,
      data: { name: shop.name, via: 'seed' },
    });
    return { shop, owner };
  });
}
