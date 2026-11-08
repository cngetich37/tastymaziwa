import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getDb, type DB } from '@/db';
import type { Role } from '@/db/schema';
import { DomainError, type Actor } from './ledger';
import { currentUser, toActor } from './session';
import type { ActionResult } from '@/lib/action-result';

export type { ActionResult } from '@/lib/action-result';

/**
 * Wraps a server action with authentication, role checks, Zod validation of
 * the raw input, error mapping and cache revalidation. Server actions are
 * public HTTP endpoints — this wrapper is what makes them safe.
 */
export function defineAction<S extends z.ZodType, T>(
  options: { schema: S; roles: Role[] },
  handler: (ctx: { db: DB; actor: Actor }, input: z.output<S>) => Promise<T>,
) {
  return async (raw: z.input<S>): Promise<ActionResult<T>> => {
    const user = await currentUser();
    if (!user) return { ok: false, error: 'Your session has expired. Please sign in again.' };
    if (!options.roles.includes(user.role)) {
      return { ok: false, error: 'You do not have permission to do that.' };
    }

    const parsed = options.schema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        error: 'Please fix the highlighted fields.',
        fieldErrors: z.flattenError(parsed.error).fieldErrors,
      };
    }

    try {
      const data = await handler({ db: await getDb(), actor: toActor(user) }, parsed.data);
      revalidatePath('/', 'layout');
      return { ok: true, data };
    } catch (error) {
      if (error instanceof DomainError) return { ok: false, error: error.message };
      console.error('[action] unexpected error', error);
      return { ok: false, error: 'Something went wrong. Nothing was saved — please try again.' };
    }
  };
}

export const ANY_ROLE: Role[] = ['owner', 'attendant'];
export const OWNER: Role[] = ['owner'];
