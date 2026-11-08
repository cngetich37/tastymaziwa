/**
 * Runs before `next build` on Vercel (see the `vercel-build` script).
 *
 * - Production deployments: apply pending migrations to the production
 *   database. If that fails, the build fails and the previous deployment
 *   keeps serving, so the app never runs against a schema it doesn't expect.
 * - Preview / development builds: skip, so they can never touch production.
 *
 * Migrations prefer a direct (unpooled) connection when one is configured:
 * Neon's Vercel integration sets DATABASE_URL_UNPOOLED, and schema changes are
 * safest outside a transaction-mode pooler.
 */
import { createDb, migrateDb } from '../src/db/client';

const env = process.env.VERCEL_ENV ?? 'local';

if (env !== 'production') {
  console.log(`[migrate-on-deploy] VERCEL_ENV=${env}: skipping migrations (production only).`);
  process.exit(0);
}

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error(
    '[migrate-on-deploy] No database URL for this Production deployment.\n' +
      'Set DATABASE_URL (pooled) in Vercel → Settings → Environment Variables for Production,\n' +
      'and optionally DATABASE_URL_UNPOOLED (direct) for migrations. Then redeploy.',
  );
  process.exit(1);
}

// migrateDb picks the Postgres migrator when DATABASE_URL is set.
process.env.DATABASE_URL ??= url;
const source = process.env.DATABASE_URL_UNPOOLED
  ? 'DATABASE_URL_UNPOOLED'
  : process.env.DIRECT_URL
    ? 'DIRECT_URL'
    : 'DATABASE_URL';

const { db, close } = await createDb({ url });
try {
  await migrateDb(db);
  console.log(`[migrate-on-deploy] Migrations applied to the production database (via ${source}).`);
} catch (error) {
  console.error('[migrate-on-deploy] Migration failed; stopping the deploy.', error);
  process.exitCode = 1;
} finally {
  await close();
}
