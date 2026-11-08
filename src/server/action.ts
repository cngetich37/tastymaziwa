import 'server-only';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
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
  handler: (ctx: { db: DB; actor: Actor; ip: string }, input: z.output<S>) => Promise<T>,
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
      const data = await handler({ db: await getDb(), actor: toActor(user), ip: await clientIp() }, parsed.data);
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

/**
 * For signed-out flows (sign-up, codes, password reset): validation and error
 * mapping, but no session. Handlers must rate-limit (see server/auth).
 */
export function definePublicAction<S extends z.ZodType, T>(
  schema: S,
  handler: (ctx: { db: DB; ip: string }, input: z.output<S>) => Promise<ActionResult<T>>,
) {
  return async (raw: z.input<S>): Promise<ActionResult<T>> => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        error: 'Please fix the highlighted fields.',
        fieldErrors: z.flattenError(parsed.error).fieldErrors,
      };
    }
    try {
      return await handler({ db: await getDb(), ip: await clientIp() }, parsed.data);
    } catch (error) {
      if (error instanceof DomainError) return { ok: false, error: error.message };
      console.error('[public action] unexpected error', error);
      return { ok: false, error: 'Something went wrong. Please try again.' };
    }
  };
}

/**
 * Client IP for rate limiting. On Vercel, x-forwarded-for is set by the edge
 * network (the left-most entry is the client); locally it's absent.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'local';
}
