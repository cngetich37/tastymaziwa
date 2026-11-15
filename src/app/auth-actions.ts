'use server';
/**
 * Signed-out server actions: sign-up, sign-in codes and password reset.
 * Sign-in itself goes through Auth.js (`signIn('password' | 'email-code')`).
 * Responses never reveal whether an email is registered.
 */
import { z } from 'zod';
import { definePublicAction } from '@/server/action';
import { startDemo } from '@/server/demo/demo';
import {
  requestLoginCode,
  requestPasswordReset,
  requestSignup,
  resetPassword,
} from '@/server/auth/accounts';
import {
  forgotPasswordSchema,
  requestCodeSchema,
  resetPasswordSchema,
  signupSchema,
} from '@/lib/validation';

const TOO_MANY = 'Too many requests. Please wait a few minutes and try again.';

/** "Try the demo": a fresh sample shop; the browser then signs in with the token. */
export const startDemoAction = definePublicAction(z.object({}), async ({ db, ip }) => {
  const result = await startDemo(db, ip);
  if (result === 'rate_limited') return { ok: false, error: 'You have started several demos already. Try again in an hour.' };
  if (result === 'busy') return { ok: false, error: 'The demo is busy right now. Please try again later.' };
  if (result === 'disabled') return { ok: false, error: 'The demo is switched off.' };
  return { ok: true, data: { token: result.token } };
});

export const requestSignupAction = definePublicAction(signupSchema, async ({ db, ip }, input) => {
  const { ok } = await requestSignup(db, input, ip);
  return ok ? { ok: true, data: { email: input.email } } : { ok: false, error: TOO_MANY };
});

export const requestLoginCodeAction = definePublicAction(requestCodeSchema, async ({ db, ip }, input) => {
  const { ok } = await requestLoginCode(db, input.email, ip);
  return ok ? { ok: true, data: { email: input.email } } : { ok: false, error: TOO_MANY };
});

export const requestPasswordResetAction = definePublicAction(forgotPasswordSchema, async ({ db, ip }, input) => {
  const { ok } = await requestPasswordReset(db, input.email, ip);
  return ok ? { ok: true, data: null } : { ok: false, error: TOO_MANY };
});

export const resetPasswordAction = definePublicAction(resetPasswordSchema, async ({ db }, input) => {
  const result = await resetPassword(db, input.token, input.password);
  return result
    ? { ok: true, data: { email: result.email } }
    : { ok: false, error: 'This link is invalid or has expired. Request a new one.' };
});
