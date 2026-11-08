import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL;

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  // Without DATABASE_URL, drizzle-kit studio/push work against the local PGlite store.
  ...(url
    ? { dbCredentials: { url } }
    : { driver: 'pglite', dbCredentials: { url: process.env.PGLITE_DIR ?? './.data/pglite' } }),
});
