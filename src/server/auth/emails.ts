/** Email templates: short, plain, readable on a phone notification. */
import type { Email } from './mailer';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(body: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#111827">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px">
<p style="margin:0 0 16px;font-size:18px;font-weight:bold">🥛 TastyMaziwa</p>
${body}
<p style="margin:24px 0 0;font-size:12px;color:#6b7280">If you didn't ask for this, you can ignore this email — nothing will change.</p>
</div></body></html>`;
}

const codeBlock = (code: string) =>
  `<p style="margin:16px 0;font-size:32px;font-weight:bold;letter-spacing:8px;font-family:monospace">${code}</p>`;

const button = (href: string, label: string) =>
  `<p style="margin:20px 0"><a href="${esc(href)}" style="background:#16a34a;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">${esc(label)}</a></p>`;

export function signupCodeEmail(to: string, code: string, minutes: number): Email {
  return {
    to,
    subject: `${code} is your TastyMaziwa sign-up code`,
    text: `Welcome to TastyMaziwa!\n\nYour code is: ${code}\n\nEnter it to finish creating your shop. It expires in ${minutes} minutes.`,
    html: layout(`<p>Welcome! Enter this code to finish creating your shop:</p>${codeBlock(code)}<p>It expires in ${minutes} minutes.</p>`),
  };
}

export function alreadyRegisteredEmail(to: string, loginUrl: string, resetUrl: string): Email {
  return {
    to,
    subject: 'You already have a TastyMaziwa account',
    text: `Someone tried to create a TastyMaziwa account with this email, but you already have one.\n\nSign in: ${loginUrl}\nForgot your password? ${resetUrl}`,
    html: layout(`<p>Someone tried to create an account with this email, but you already have one.</p>${button(loginUrl, 'Sign in')}<p><a href="${esc(resetUrl)}">Forgot your password?</a></p>`),
  };
}

export function loginCodeEmail(to: string, code: string, minutes: number): Email {
  return {
    to,
    subject: `${code} is your TastyMaziwa sign-in code`,
    text: `Your sign-in code is: ${code}\n\nIt expires in ${minutes} minutes. Never share it with anyone.`,
    html: layout(`<p>Your sign-in code:</p>${codeBlock(code)}<p>It expires in ${minutes} minutes. Never share it with anyone.</p>`),
  };
}

export function passwordResetEmail(to: string, url: string, minutes: number): Email {
  return {
    to,
    subject: 'Reset your TastyMaziwa password',
    text: `Reset your password using this link (valid for ${minutes} minutes):\n\n${url}`,
    html: layout(`<p>Tap below to choose a new password. The link works once and expires in ${minutes} minutes.</p>${button(url, 'Reset password')}`),
  };
}

export function passwordChangedEmail(to: string): Email {
  return {
    to,
    subject: 'Your TastyMaziwa password was changed',
    text: 'Your password was just changed and you were signed out on other devices. If this wasn\'t you, reset your password now.',
    html: layout('<p>Your password was just changed and you were signed out on other devices.</p><p>If this wasn\'t you, reset your password immediately.</p>'),
  };
}

export function inviteEmail(to: string, inviter: string, shop: string, url: string, hours: number): Email {
  return {
    to,
    subject: `${inviter} added you to ${shop} on TastyMaziwa`,
    text: `${inviter} added you to ${shop} on TastyMaziwa.\n\nSet your password here (valid for ${hours} hours):\n${url}\n\nYou can also sign in any time with a code sent to this email.`,
    html: layout(`<p><strong>${esc(inviter)}</strong> added you to <strong>${esc(shop)}</strong>.</p>${button(url, 'Set your password')}<p>The link is valid for ${hours} hours. You can also sign in with a code sent to this email.</p>`),
  };
}

export function emailChangeCodeEmail(to: string, code: string, minutes: number): Email {
  return {
    to,
    subject: `${code} confirms your new TastyMaziwa email`,
    text: `Enter this code to confirm your new email address: ${code}\n\nIt expires in ${minutes} minutes.`,
    html: layout(`<p>Enter this code to confirm your new email address:</p>${codeBlock(code)}<p>It expires in ${minutes} minutes.</p>`),
  };
}

export function emailChangedNotice(to: string, newEmail: string): Email {
  return {
    to,
    subject: 'Your TastyMaziwa email was changed',
    text: `Your sign-in email was changed to ${newEmail}. If this wasn't you, contact your shop owner immediately.`,
    html: layout(`<p>Your sign-in email was changed to <strong>${esc(newEmail)}</strong>.</p><p>If this wasn't you, contact your shop owner immediately.</p>`),
  };
}
