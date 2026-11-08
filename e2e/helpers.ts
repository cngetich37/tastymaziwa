import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { OUTBOX } from '../playwright.config';

interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** Wait for the newest email to `to` (optionally newer than `after` count). */
export async function waitForMail(to: string, opts: { after?: number; outbox?: string } = {}): Promise<Mail> {
  const dir = path.resolve(opts.outbox ?? OUTBOX.main);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const mails = existsSync(dir)
      ? readdirSync(dir)
          .sort()
          .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as Mail)
          .filter((m) => m.to === to)
      : [];
    if (mails.length > (opts.after ?? 0)) return mails.at(-1)!;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No email to ${to} within 10s`);
}

export function mailCount(to: string, outbox = OUTBOX.main): number {
  const dir = path.resolve(outbox);
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => {
    const m = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as Mail;
    return m.to === to;
  }).length;
}

export const codeFrom = (m: Mail) => /\b(\d{6})\b/.exec(m.text)?.[1] ?? '';
export const linkFrom = (m: Mail) => /(https?:\/\/\S+token=\S+)/.exec(m.text)?.[1] ?? '';

/**
 * Wait until the form is hydrated (its submit button enables). Typing earlier
 * races hydration, which resets controlled inputs.
 */
export async function formReady(page: Page, submit: string) {
  await expect(page.getByRole('button', { name: submit, exact: true })).toBeEnabled();
}

export async function signInWithPassword(page: Page, email: string, password: string) {
  await page.goto('/login');
  await formReady(page, 'Sign in');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
}

/** Unique address per test run so reruns never collide. */
export const uniqueEmail = (label: string) => `${label}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@e2e.test`;

/** Sign up a brand-new shop through the UI; ends signed in on Today. */
export async function signUpShop(page: Page, opts: { shop: string; email: string; password: string }) {
  await page.goto('/signup');
  await formReady(page, 'Continue');
  await page.getByLabel('Shop name').fill(opts.shop);
  await page.getByLabel('Your name').fill('New Owner');
  await page.getByLabel('Email', { exact: true }).fill(opts.email);
  await page.getByLabel('Password', { exact: true }).fill(opts.password);
  const before = mailCount(opts.email);
  await page.getByRole('button', { name: 'Continue' }).click();
  const mail = await waitForMail(opts.email, { after: before });
  await page.getByLabel('Code', { exact: true }).fill(codeFrom(mail));
  await page.getByRole('button', { name: 'Create my shop' }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
}
