/** Apply pending migrations: `npm run db:migrate`. */
import { createDb, migrateDb } from '../src/db/client';

const { db, close } = await createDb();
await migrateDb(db);
await close();
console.log(`Migrations applied (${process.env.DATABASE_URL ? 'Postgres' : 'local PGlite'}).`);
