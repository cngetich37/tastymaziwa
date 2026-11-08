import { eq } from 'drizzle-orm';
import type { DB } from '@/db/client';
import { auditLog, users } from '@/db/schema';
import type { NewUserInput } from '@/lib/validation';
import { DomainError, type Actor } from './ledger';
import { hashPassword } from './password';

export async function createUser(db: DB, actor: Actor, input: NewUserInput) {
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, input.username));
    if (existing) throw new DomainError('That username is already taken');
    const [user] = await tx
      .insert(users)
      .values({ name: input.name, username: input.username, passwordHash, role: input.role })
      .returning({ id: users.id, name: users.name, username: users.username, role: users.role });
    await tx.insert(auditLog).values({
      userId: actor.id,
      action: 'user.create',
      entityType: 'user',
      entityId: user.id,
      data: { username: user.username, role: user.role },
    });
    return user;
  });
}

export function listUsers(db: DB) {
  return db
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      role: users.role,
      active: users.active,
    })
    .from(users)
    .orderBy(users.name);
}
