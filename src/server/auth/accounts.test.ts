/**
 * Auth flows end to end against real Postgres (PGlite) and the file outbox:
 * codes and links are read from the "sent" emails exactly as a user would.
 */
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, migrateDb, type DB } from '@/db/client';
import { authTokens, shops, users } from '@/db/schema';
import { DomainError, type Actor } from '../ledger';
import {
  changePassword,
  completeSignup,
  confirmEmailChange,
  getSessionState,
  inviteStaff,
  passwordLogin,
  requestEmailChange,
  requestLoginCode,
  requestPasswordReset,
  requestSignup,
  resetPassword,
  setUserActive,
  verifyLoginCode,
  type AuthUser,
} from './accounts';

const outbox = mkdtempSync(path.join(tmpdir(), 'tm-outbox-'));
process.env.EMAIL_OUTBOX_DIR = outbox;
process.env.AUTH_SECRET = 'test-secret-for-hmac';

let db: DB;
let close: () => Promise<void>;
let ipCounter = 0;
/** Fresh IP per call so per-IP limits don't interfere across tests. */
const ip = () => `10.0.0.${++ipCounter}`;

interface Sent {
  to: string;
  subject: string;
  text: string;
}

function mailTo(to: string): Sent[] {
  return readdirSync(outbox)
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(outbox, f), 'utf8')) as Sent)
    .filter((m) => m.to === to);
}
const lastMail = (to: string) => mailTo(to).at(-1);
const codeIn = (m?: Sent) => /\b(\d{6})\b/.exec(m?.text ?? '')?.[1] ?? '';
const tokenIn = (m?: Sent) => decodeURIComponent(/token=([^\s]+)/.exec(m?.text ?? '')?.[1] ?? '');
const wrong = (code: string) => (code === '000000' ? '111111' : '000000');

async function signUp(email: string, password = 'correct horse battery'): Promise<AuthUser> {
  await requestSignup(db, { shopName: `${email} shop`, name: 'Owner', email, password }, ip());
  const user = await completeSignup(db, email, codeIn(lastMail(email)));
  if (typeof user === 'string') throw new Error(`signup failed: ${user}`);
  return user;
}

const actorOf = (u: AuthUser): Actor => ({ id: u.id, role: u.role, shopId: u.shopId });

beforeAll(async () => {
  ({ db, close } = await createDb({ pgliteDir: 'memory://' }));
  await migrateDb(db);
});
afterAll(() => close());

describe('sign-up', () => {
  it('emails a code, and only creates the shop and owner once it is entered', async () => {
    const email = 'jane@shop.test';
    const result = await requestSignup(db, { shopName: 'Jane Dairy', name: 'Jane', email, password: 'a-good-password' }, ip());
    expect(result.ok).toBe(true);
    expect(await db.$count(users, eq(users.email, email))).toBe(0);

    const code = codeIn(lastMail(email));
    expect(code).toMatch(/^\d{6}$/);
    expect(await completeSignup(db, email, wrong(code))).toBe('invalid');

    const user = await completeSignup(db, email, code);
    expect(user).toMatchObject({ email, role: 'owner', name: 'Jane' });
    const [shop] = await db.select().from(shops).where(eq(shops.id, (user as AuthUser).shopId));
    expect(shop.name).toBe('Jane Dairy');

    // Single use.
    expect(await completeSignup(db, email, code)).toBe('invalid');
    // The password chosen at sign-up works.
    expect(await passwordLogin(db, email, 'a-good-password')).toMatchObject({ email });
  });

  it("doesn't reveal that an email is taken; it tells the real owner instead", async () => {
    const email = 'taken@shop.test';
    await signUp(email);
    const result = await requestSignup(db, { shopName: 'Imposter', name: 'X', email, password: 'another-password' }, ip());
    expect(result.ok).toBe(true);
    expect(lastMail(email)?.subject).toMatch(/already have/i);
    expect(codeIn(lastMail(email))).toBe('');
  });

  it('gives every sign-up its own shop', async () => {
    const a = await signUp('a@tenant.test');
    const b = await signUp('b@tenant.test');
    expect(a.shopId).not.toBe(b.shopId);
  });
});

describe('passwordless sign-in codes', () => {
  it('signs in with the emailed code, once', async () => {
    const email = 'code@shop.test';
    await signUp(email);
    await requestLoginCode(db, email, ip());
    const code = codeIn(lastMail(email));
    expect(await verifyLoginCode(db, email, code)).toMatchObject({ email });
    expect(await verifyLoginCode(db, email, code)).toBe('invalid');
  });

  it('sends nothing for unknown addresses but answers the same', async () => {
    const result = await requestLoginCode(db, 'nobody@shop.test', ip());
    expect(result.ok).toBe(true);
    expect(mailTo('nobody@shop.test')).toHaveLength(0);
  });

  it('kills the code after 5 wrong guesses, even if the 6th is right', async () => {
    const email = 'guess@shop.test';
    await signUp(email);
    await requestLoginCode(db, email, ip());
    const code = codeIn(lastMail(email));
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await verifyLoginCode(db, email, wrong(code)));
    expect(results.at(-1)).toBe('too_many_attempts');
    expect(await verifyLoginCode(db, email, code)).toBe('too_many_attempts');
  });

  it('rejects expired codes', async () => {
    const email = 'late@shop.test';
    await signUp(email);
    await requestLoginCode(db, email, ip());
    await db.update(authTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(authTokens.email, email));
    expect(await verifyLoginCode(db, email, codeIn(lastMail(email)))).toBe('expired');
  });

  it('a newer code replaces the previous one', async () => {
    const email = 'twice@shop.test';
    await signUp(email);
    await requestLoginCode(db, email, ip());
    const first = codeIn(lastMail(email));
    await requestLoginCode(db, email, ip());
    const second = codeIn(lastMail(email));
    if (first !== second) expect(await verifyLoginCode(db, email, first)).toBe('invalid');
    expect(await verifyLoginCode(db, email, second)).toMatchObject({ email });
  });

  it('rate-limits emails per address', async () => {
    const email = 'spam@shop.test';
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await requestLoginCode(db, email, ip())).ok);
    expect(results).toEqual([true, true, true, false]);
  });
});

describe('password sign-in', () => {
  it('locks the address after 5 failures, even for the right password', async () => {
    const email = 'brute@shop.test';
    await signUp(email, 'the-real-password');
    for (let i = 0; i < 5; i++) expect(await passwordLogin(db, email, 'guess-' + i)).toBe('invalid');
    expect(await passwordLogin(db, email, 'the-real-password')).toBe('rate_limited');
  });

  it('gives the same answer for unknown emails and wrong passwords', async () => {
    expect(await passwordLogin(db, 'ghost@shop.test', 'whatever-password')).toBe('invalid');
  });
});

describe('password reset', () => {
  it('resets via the emailed link, once, and ends existing sessions', async () => {
    const email = 'forgot@shop.test';
    const user = await signUp(email, 'old-password-123');
    await requestPasswordReset(db, email, ip());
    const token = tokenIn(lastMail(email));
    expect(token.length).toBeGreaterThan(30);

    expect(await resetPassword(db, token, 'new-password-456')).toEqual({ email });
    expect(await passwordLogin(db, email, 'old-password-123')).toBe('invalid');
    expect(await passwordLogin(db, email, 'new-password-456')).toMatchObject({ email });
    expect((await getSessionState(db, user.id))!.sessionVersion).toBe(user.sessionVersion + 1);
    expect(lastMail(email)?.subject).toMatch(/password was changed/i);

    expect(await resetPassword(db, token, 'third-password-789')).toBeNull();
  });

  it('rejects made-up tokens', async () => {
    expect(await resetPassword(db, 'x'.repeat(43), 'some-new-password')).toBeNull();
  });
});

describe('signed-in account changes', () => {
  it('changing the password needs the current one and bumps the session version', async () => {
    const user = await signUp('change@shop.test', 'first-password-1');
    await expect(changePassword(db, actorOf(user), 'not-it', 'second-password-2')).rejects.toBeInstanceOf(DomainError);
    const version = await changePassword(db, actorOf(user), 'first-password-1', 'second-password-2');
    expect(version).toBe(user.sessionVersion + 1);
    expect(await passwordLogin(db, user.email, 'second-password-2')).toMatchObject({ id: user.id });
  });

  it('changes email only after a code sent to the new address', async () => {
    const user = await signUp('old@shop.test', 'password-for-email');
    await requestEmailChange(db, actorOf(user), 'new@shop.test', ip());
    await expect(confirmEmailChange(db, actorOf(user), 'new@shop.test', '000000')).rejects.toBeInstanceOf(DomainError);
    // (a wrong guess may collide with the real code 1 in a million times — fine)
    await requestEmailChange(db, actorOf(user), 'new@shop.test', ip());
    await confirmEmailChange(db, actorOf(user), 'new@shop.test', codeIn(lastMail('new@shop.test')));
    expect(await passwordLogin(db, 'new@shop.test', 'password-for-email')).toMatchObject({ id: user.id });
    expect(lastMail('old@shop.test')?.subject).toMatch(/email was changed/i);
  });

  it("won't take an address someone else uses", async () => {
    const user = await signUp('mine@shop.test');
    await signUp('theirs@shop.test');
    await expect(requestEmailChange(db, actorOf(user), 'theirs@shop.test', ip())).rejects.toBeInstanceOf(DomainError);
  });
});

describe('team management', () => {
  it('invites staff into the same shop; they set a password from the link', async () => {
    const owner = await signUp('boss@shop.test');
    await inviteStaff(db, actorOf(owner), { name: 'Counter Staff', email: 'staff@shop.test', role: 'attendant' });
    const invite = lastMail('staff@shop.test');
    expect(invite?.subject).toMatch(/added you/i);

    // No password yet, but email codes already work.
    expect(await passwordLogin(db, 'staff@shop.test', 'anything-at-all')).toBe('invalid');
    await resetPassword(db, tokenIn(invite), 'staff-password-1');
    const staff = await passwordLogin(db, 'staff@shop.test', 'staff-password-1');
    expect(staff).toMatchObject({ role: 'attendant', shopId: owner.shopId });
  });

  it('deactivating someone blocks sign-in and invalidates their sessions', async () => {
    const owner = await signUp('manager@shop.test');
    await inviteStaff(db, actorOf(owner), { name: 'Temp', email: 'temp@shop.test', role: 'attendant' });
    await resetPassword(db, tokenIn(lastMail('temp@shop.test')), 'temp-password-1');
    const temp = (await passwordLogin(db, 'temp@shop.test', 'temp-password-1')) as AuthUser;

    await setUserActive(db, actorOf(owner), temp.id, false);
    expect(await passwordLogin(db, 'temp@shop.test', 'temp-password-1')).toBe('invalid');
    const state = await getSessionState(db, temp.id);
    expect(state?.active).toBe(false);
    expect(state?.sessionVersion).toBe(temp.sessionVersion + 1);

    await expect(setUserActive(db, actorOf(owner), owner.id, false)).rejects.toBeInstanceOf(DomainError);
  });

  it("can't manage users in another shop", async () => {
    const ownerA = await signUp('owner-a@team.test');
    const ownerB = await signUp('owner-b@team.test');
    await expect(setUserActive(db, actorOf(ownerA), ownerB.id, false)).rejects.toBeInstanceOf(DomainError);
  });
});
