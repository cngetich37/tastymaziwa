/**
 * Create a user from the command line:
 *   npm run user:create -- <username> <role: owner|attendant> "<Full Name>"
 * The password is read from the TM_PASSWORD env var, or generated and printed.
 */
import { randomBytes } from 'node:crypto';
import { createDb, migrateDb } from '../src/db/client';
import { newUserSchema } from '../src/lib/validation';
import { SYSTEM_ACTOR } from '../src/server/ledger';
import { createUser } from '../src/server/users';

const [username, role = 'attendant', ...nameParts] = process.argv.slice(2);
if (!username) {
  console.error('Usage: npm run user:create -- <username> <owner|attendant> "<Full Name>"');
  process.exit(1);
}

const generated = !process.env.TM_PASSWORD;
const password = process.env.TM_PASSWORD ?? randomBytes(9).toString('base64url');
const input = newUserSchema.parse({ username, role, name: nameParts.join(' ') || username, password });

const { db, close } = await createDb();
await migrateDb(db);
try {
  const user = await createUser(db, SYSTEM_ACTOR, input);
  console.log(`Created ${user.role} "${user.username}".`);
  if (generated) console.log(`Password: ${password}   (shown once — store it safely)`);
} finally {
  await close();
}
