import 'server-only';
import { createDb, migrateDb, type DB } from './client';

export type { DB, Tx } from './client';
export * as schema from './schema';

// Cache on globalThis so dev-mode hot reloads reuse one connection. Two PGlite
// instances on the same directory would corrupt it.
const globalForDb = globalThis as unknown as { __tastyDb?: Promise<DB> };

async function init(): Promise<DB> {
  const { db } = await createDb();
  // The embedded dev database migrates itself so `npm run dev` just works.
  // Hosted Postgres is migrated explicitly with `npm run db:migrate`.
  if (!process.env.DATABASE_URL) await migrateDb(db);
  return db;
}

export function getDb(): Promise<DB> {
  globalForDb.__tastyDb ??= init().catch((error) => {
    globalForDb.__tastyDb = undefined;
    throw error;
  });
  return globalForDb.__tastyDb;
}
