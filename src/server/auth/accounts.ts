/**
 * Account lifecycle: sign-up (creates a shop), password and passwordless
 * sign-in, password reset, password/email change, staff invites.
 *
 * Public flows never reveal whether an email is registered: "request" calls
 * always report success (unless rate-limited) and only send mail when there is
 * something to send.
 *
 * Code checks run outside any transaction on purpose: a failed guess must
 * stay counted even if a later step throws.
 */
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import type { DB } from '@/db/client';
import { auditLog, authTokens, shops, users, type Role } from '@/db/schema';
import type { InviteStaffInput, SignupInput } from '@/lib/validation';
import { DomainError, type Actor } from '../ledger';
import { dummyVerify, hashPassword, verifyPassword } from '../password';
import { appUrl, authConfig } from './config';
import * as emails from './emails';
import { sendEmail } from './mailer';
import { consume, countRecent, limits, recordHit } from './rate-limit';
import { consumeLinkToken, generateCode, generateLinkToken, issueToken, verifyCode, type CodeCheck } from './tokens';

/** What a session is built from. */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  shopId: string;
  sessionVersion: number;
}

export type AuthFailure = 'invalid' | 'expired' | 'too_many_attempts' | 'rate_limited';

const minutes = (s: number) => Math.round(s / 60);

const authUserColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  shopId: users.shopId,
  sessionVersion: users.sessionVersion,
};

async function findActiveUser(db: DB, email: string) {
  const [user] = await db
    .select({ ...authUserColumns, passwordHash: users.passwordHash, emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(and(eq(users.email, email), eq(users.active, true)));
  return user ?? null;
}

const failure = (check: Exclude<CodeCheck, { ok: true }>): AuthFailure => check.reason;

// --- sign-up -----------------------------------------------------------------

interface PendingSignup {
  shopName: string;
  name: string;
  passwordHash: string;
}

/** Step 1: email a code. The account only exists once the code is entered. */
export async function requestSignup(db: DB, input: SignupInput, ip: string): Promise<{ ok: boolean }> {
  if (!(await consume(db, limits.sendEmail(input.email, ip)))) return { ok: false };

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email));
  if (existing) {
    // Don't reveal that the address is registered; tell its owner instead.
    await sendEmail(emails.alreadyRegisteredEmail(input.email, `${appUrl()}/login`, `${appUrl()}/forgot-password`));
    return { ok: true };
  }

  const code = generateCode();
  const pending: PendingSignup = {
    shopName: input.shopName,
    name: input.name,
    passwordHash: await hashPassword(input.password),
  };
  await issueToken(db, {
    purpose: 'signup',
    email: input.email,
    secret: code,
    ttlSeconds: authConfig.signupCodeTtlSeconds,
    data: pending,
  });
  await sendEmail(emails.signupCodeEmail(input.email, code, minutes(authConfig.signupCodeTtlSeconds)));
  return { ok: true };
}

/** Step 2: the code proves the address; create the shop and its owner. */
export async function completeSignup(db: DB, email: string, code: string): Promise<AuthUser | AuthFailure> {
  const check = await verifyCode(db, email, 'signup', code);
  if (!check.ok) return failure(check);
  const pending = check.token.data as PendingSignup;

  return db.transaction(async (tx) => {
    const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (taken) return 'invalid' as const;
    const [shop] = await tx.insert(shops).values({ name: pending.shopName }).returning();
    const [user] = await tx
      .insert(users)
      .values({
        shopId: shop.id,
        name: pending.name,
        email,
        emailVerifiedAt: new Date(),
        passwordHash: pending.passwordHash,
        role: 'owner',
      })
      .returning(authUserColumns);
    await tx.insert(auditLog).values({
      shopId: shop.id,
      userId: user.id,
      action: 'shop.create',
      entityType: 'shop',
      entityId: shop.id,
      data: { name: shop.name, via: 'signup' },
    });
    return user;
  });
}

// --- sign-in -------------------------------------------------------------------

export async function passwordLogin(db: DB, email: string, password: string): Promise<AuthUser | AuthFailure> {
  const lock = limits.loginFailures(email);
  if ((await countRecent(db, lock.key, lock.windowSeconds)) >= lock.max) return 'rate_limited';

  const user = await findActiveUser(db, email);
  const valid = user?.passwordHash
    ? await verifyPassword(password, user.passwordHash)
    : (await dummyVerify(password), false);
  if (!user || !valid) {
    await recordHit(db, lock.key);
    return 'invalid';
  }
  return pick(user);
}

export async function requestLoginCode(db: DB, email: string, ip: string): Promise<{ ok: boolean }> {
  if (!(await consume(db, limits.sendEmail(email, ip)))) return { ok: false };
  const user = await findActiveUser(db, email);
  if (user) {
    const code = generateCode();
    await issueToken(db, {
      purpose: 'login_code',
      email,
      userId: user.id,
      secret: code,
      ttlSeconds: authConfig.codeTtlSeconds,
    });
    await sendEmail(emails.loginCodeEmail(email, code, minutes(authConfig.codeTtlSeconds)));
  }
  return { ok: true };
}

export async function verifyLoginCode(db: DB, email: string, code: string): Promise<AuthUser | AuthFailure> {
  const check = await verifyCode(db, email, 'login_code', code);
  if (!check.ok) return failure(check);
  const user = await findActiveUser(db, email);
  if (!user || user.id !== check.token.userId) return 'invalid';
  // Receiving the code proves the address (e.g. invited staff signing in first time).
  if (!user.emailVerifiedAt) {
    await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, user.id));
  }
  return pick(user);
}

// --- password reset --------------------------------------------------------------

export async function requestPasswordReset(db: DB, email: string, ip: string): Promise<{ ok: boolean }> {
  if (!(await consume(db, limits.sendEmail(email, ip)))) return { ok: false };
  const user = await findActiveUser(db, email);
  if (user) {
    const token = generateLinkToken();
    await issueToken(db, {
      purpose: 'password_reset',
      email,
      userId: user.id,
      secret: token,
      ttlSeconds: authConfig.resetTtlSeconds,
    });
    const url = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
    await sendEmail(emails.passwordResetEmail(email, url, minutes(authConfig.resetTtlSeconds)));
  }
  return { ok: true };
}

/** Sets a new password from an emailed link; signs out every existing session. */
export async function resetPassword(db: DB, token: string, password: string): Promise<{ email: string } | null> {
  const passwordHash = await hashPassword(password);
  const result = await db.transaction(async (tx) => {
    const row = await consumeLinkToken(tx, 'password_reset', token);
    if (!row?.userId) return null;
    const [user] = await tx
      .update(users)
      .set({
        passwordHash,
        sessionVersion: sql`${users.sessionVersion} + 1`,
        // The link was delivered to this address, which proves it.
        emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())`,
      })
      .where(and(eq(users.id, row.userId), eq(users.active, true)))
      .returning({ id: users.id, email: users.email, shopId: users.shopId });
    if (!user) return null;
    // Any other outstanding reset links for this user die too.
    await tx
      .update(authTokens)
      .set({ consumedAt: new Date() })
      .where(and(eq(authTokens.userId, user.id), eq(authTokens.purpose, 'password_reset'), isNull(authTokens.consumedAt)));
    await tx.insert(auditLog).values({
      shopId: user.shopId,
      userId: user.id,
      action: 'user.password_reset',
      entityType: 'user',
      entityId: user.id,
    });
    return { email: user.email };
  });
  if (result) await sendEmail(emails.passwordChangedEmail(result.email));
  return result;
}

// --- signed-in account management -----------------------------------------------

/** Returns the new session version so the caller can keep this session alive. */
export async function changePassword(
  db: DB,
  actor: Actor,
  currentPassword: string,
  newPassword: string,
): Promise<number> {
  const [user] = await db.select().from(users).where(eq(users.id, actor.id!));
  if (!user) throw new DomainError('Account not found');
  // Passwordless-only accounts (no hash yet) can set one without a current password.
  if (user.passwordHash && !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new DomainError('Your current password is incorrect');
  }
  const passwordHash = await hashPassword(newPassword);
  const version = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(users)
      .set({ passwordHash, sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, user.id))
      .returning({ sessionVersion: users.sessionVersion });
    await tx.insert(auditLog).values({
      shopId: user.shopId,
      userId: user.id,
      action: 'user.password_change',
      entityType: 'user',
      entityId: user.id,
    });
    return row.sessionVersion;
  });
  await sendEmail(emails.passwordChangedEmail(user.email));
  return version;
}

export async function requestEmailChange(db: DB, actor: Actor, newEmail: string, ip: string): Promise<void> {
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, newEmail));
  if (taken) throw new DomainError('That email is already in use');
  if (!(await consume(db, limits.sendEmail(newEmail, ip)))) {
    throw new DomainError('Too many requests. Please wait a few minutes and try again.');
  }
  const code = generateCode();
  await issueToken(db, {
    purpose: 'email_change',
    email: newEmail,
    userId: actor.id,
    secret: code,
    ttlSeconds: authConfig.codeTtlSeconds,
  });
  await sendEmail(emails.emailChangeCodeEmail(newEmail, code, minutes(authConfig.codeTtlSeconds)));
}

export async function confirmEmailChange(db: DB, actor: Actor, newEmail: string, code: string): Promise<void> {
  const check = await verifyCode(db, newEmail, 'email_change', code);
  if (!check.ok || check.token.userId !== actor.id) {
    throw new DomainError(
      check.ok || check.reason === 'invalid'
        ? 'That code is not correct'
        : check.reason === 'expired'
          ? 'That code has expired. Request a new one.'
          : 'Too many wrong attempts. Request a new code.',
    );
  }
  const oldEmail = await db.transaction(async (tx) => {
    const [before] = await tx.select({ email: users.email, shopId: users.shopId }).from(users).where(eq(users.id, actor.id!));
    const [clash] = await tx.select({ id: users.id }).from(users).where(and(eq(users.email, newEmail), ne(users.id, actor.id!)));
    if (clash) throw new DomainError('That email is already in use');
    await tx.update(users).set({ email: newEmail, emailVerifiedAt: new Date() }).where(eq(users.id, actor.id!));
    await tx.insert(auditLog).values({
      shopId: before.shopId,
      userId: actor.id,
      action: 'user.email_change',
      entityType: 'user',
      entityId: actor.id,
      data: { from: before.email, to: newEmail },
    });
    return before.email;
  });
  await sendEmail(emails.emailChangedNotice(oldEmail, newEmail));
}

export async function updateProfile(db: DB, actor: Actor, name: string): Promise<void> {
  await db.update(users).set({ name }).where(eq(users.id, actor.id!));
}

// --- shop & team (owner) -----------------------------------------------------------

export async function renameShop(db: DB, actor: Actor, name: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(shops).set({ name }).where(eq(shops.id, actor.shopId));
    await tx.insert(auditLog).values({
      shopId: actor.shopId,
      userId: actor.id,
      action: 'shop.rename',
      entityType: 'shop',
      entityId: actor.shopId,
      data: { name },
    });
  });
}

/** Adds a staff member and emails them a link to set a password. */
export async function inviteStaff(db: DB, actor: Actor, input: InviteStaffInput) {
  const token = generateLinkToken();
  const { user, shopName, inviterName } = await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, input.email));
    if (existing) throw new DomainError('That email already has a TastyMaziwa account');
    const [user] = await tx
      .insert(users)
      .values({ shopId: actor.shopId, name: input.name, email: input.email, role: input.role })
      .returning({ id: users.id, email: users.email });
    await issueToken(tx, {
      purpose: 'password_reset',
      email: input.email,
      userId: user.id,
      secret: token,
      ttlSeconds: authConfig.inviteTtlSeconds,
      data: { invite: true },
    });
    await tx.insert(auditLog).values({
      shopId: actor.shopId,
      userId: actor.id,
      action: 'user.invite',
      entityType: 'user',
      entityId: user.id,
      data: { email: input.email, role: input.role },
    });
    const [shop] = await tx.select({ name: shops.name }).from(shops).where(eq(shops.id, actor.shopId));
    const [inviter] = await tx.select({ name: users.name }).from(users).where(eq(users.id, actor.id!));
    return { user, shopName: shop.name, inviterName: inviter?.name ?? 'Your shop owner' };
  });
  const url = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  await sendEmail(emails.inviteEmail(input.email, inviterName, shopName, url, authConfig.inviteTtlSeconds / 3600));
  return user;
}

export async function setUserActive(db: DB, actor: Actor, userId: string, active: boolean): Promise<void> {
  if (userId === actor.id) throw new DomainError("You can't deactivate your own account");
  await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ role: users.role })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.shopId, actor.shopId)));
    if (!target) throw new DomainError('User not found');
    await tx
      .update(users)
      // Bumping the version ends their sessions at the next check.
      .set({ active, sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, userId));
    await tx.insert(auditLog).values({
      shopId: actor.shopId,
      userId: actor.id,
      action: active ? 'user.activate' : 'user.deactivate',
      entityType: 'user',
      entityId: userId,
    });
  });
}

// --- session support ---------------------------------------------------------------

/** Current state for re-validating a live session. */
export async function getSessionState(db: DB, userId: string) {
  const [row] = await db
    .select({ ...authUserColumns, active: users.active })
    .from(users)
    .where(eq(users.id, userId));
  return row ?? null;
}

function pick(u: AuthUser): AuthUser {
  return { id: u.id, name: u.name, email: u.email, role: u.role, shopId: u.shopId, sessionVersion: u.sessionVersion };
}
