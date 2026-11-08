'use server';
/**
 * Signed-out server actions: sign-up, sign-in codes and password reset.
 * Sign-in itself goes through Auth.js (`signIn('password' | 'email-code')`).
 * Responses never reveal whether an email is registered.
 */
import { definePublicAction } from '@/server/action';
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
