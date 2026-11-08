/**
 * Database connection. Uses Postgres when DATABASE_URL is set, otherwise an
 * embedded PGlite store on disk (local development; zero setup).
 *
 * This module has no `server-only` guard so that CLI scripts and tests can use
 * it; app code should import from `@/db` instead.
 */
import path from 'node:path';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;
/** A DB handle or an open transaction; services accept either. */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0] | DB;

const MIGRATIONS_DIR = path.resolve(/*turbopackIgnore: true*/ process.cwd(), 'drizzle');

export async function createDb(options: { url?: string; pgliteDir?: string } = {}): Promise<{
  db: DB;
  close: () => Promise<void>;
}> {
  const url = options.url ?? process.env.DATABASE_URL;
  if (url) {
    const { default: postgres } = await import('postgres');
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const client = postgres(url, {
      // Serverless functions each hold their own pool: keep it tiny on Vercel
      // and point DATABASE_URL at your provider's pooled connection string.
      max: process.env.VERCEL ? 1 : 10,
      // Transaction-mode poolers (Neon, Supabase) don't support prepared statements.
      prepare: false,
      // Informational notices ("already exists, skipping") just clutter logs.
      onnotice: () => {},
    });
    return {
      db: drizzle(client, { schema }) as unknown as DB,
      close: () => client.end(),
    };
  }

  // Vercel has no persistent disk: never silently fall back to a local database there.
  if (process.env.VERCEL) {
    throw new Error(
      'DATABASE_URL is not set. On Vercel, set it to a hosted Postgres connection string ' +
        '(Settings → Environment Variables), then redeploy.',
    );
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  // "memory://" gives a throwaway in-memory database (used by tests).
  const dir = options.pgliteDir ?? process.env.PGLITE_DIR ?? './.data/pglite';
  let client: InstanceType<typeof PGlite>;
  if (dir === 'memory://') {
    client = new PGlite();
  } else {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(path.resolve(/*turbopackIgnore: true*/ dir), { recursive: true });
    client = new PGlite(path.resolve(/*turbopackIgnore: true*/ dir));
  }
  return {
    db: drizzle(client, { schema }) as unknown as DB,
    close: () => client.close(),
  };
}

export async function migrateDb(db: DB): Promise<void> {
  if (process.env.DATABASE_URL) {
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- driver-specific handle
    await migrate(db as any, { migrationsFolder: MIGRATIONS_DIR });
  } else {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- driver-specific handle
    await migrate(db as any, { migrationsFolder: MIGRATIONS_DIR });
  }
}
