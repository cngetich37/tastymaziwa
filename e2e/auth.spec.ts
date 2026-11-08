import { expect, test } from '@playwright/test';
import { E2E_OWNER } from '../playwright.config';
import { codeFrom, linkFrom, mailCount, signInWithPassword, signUpShop, uniqueEmail, waitForMail } from './helpers';

test('sign up creates a new, empty shop of your own', async ({ page }) => {
  const email = uniqueEmail('signup');
  await signUpShop(page, { shop: 'Kilimani Maziwa', email, password: 'signup-password-1' });

  await expect(page.getByRole('banner')).toContainText('Kilimani Maziwa');
  // Nothing from the seeded "E2E Dairy" shop leaks in.
  const stats = page.getByRole('region', { name: "Today's figures" });
  await expect(stats).toContainText('Ksh 0');
  await page.goto('/credit');
  await expect(page.getByText('No customers yet.')).toBeVisible();
});

test('a wrong sign-up code is rejected', async ({ page }) => {
  const email = uniqueEmail('badcode');
  await page.goto('/signup');
  await page.getByLabel('Shop name').fill('Wrong Code Dairy');
  await page.getByLabel('Your name').fill('Someone');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('another-password-1');
  await page.getByRole('button', { name: 'Continue' }).click();
  const code = codeFrom(await waitForMail(email));
  await page.getByLabel('Code', { exact: true }).fill(code === '000000' ? '111111' : '000000');
  await page.getByRole('button', { name: 'Create my shop' }).click();
  await expect(page.getByRole('alert').filter({ hasText: "didn't work" })).toBeVisible();
  await expect(page).toHaveURL(/\/signup/);
});

test('passwordless: sign in with a code sent by email', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('tab', { name: 'Email me a code' }).click();
  await page.getByLabel('Email', { exact: true }).fill(E2E_OWNER.email);
  const before = mailCount(E2E_OWNER.email);
  await page.getByRole('button', { name: 'Send code' }).click();
  const mail = await waitForMail(E2E_OWNER.email, { after: before });
  expect(mail.subject).toMatch(/sign-in code/);

  await page.getByLabel('Code', { exact: true }).fill(codeFrom(mail));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.getByRole('banner')).toContainText('E2E Dairy');
});

test('forgot password: reset via the emailed link, then sign in', async ({ page }) => {
  const email = uniqueEmail('forgot');
  await signUpShop(page, { shop: 'Forgetful Dairy', email, password: 'original-password' });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  const before = mailCount(email);
  await page.getByRole('button', { name: 'Email me a reset link' }).click();
  await expect(page.getByText(/we've emailed a link/i)).toBeVisible();

  const link = linkFrom(await waitForMail(email, { after: before }));
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill('brand-new-password');
  await page.getByLabel('Confirm new password').fill('brand-new-password');
  await page.getByRole('button', { name: 'Save password' }).click();

  await expect(page).toHaveURL(/\/login\?reset=1/);
  await expect(page.getByText('Password updated')).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('original-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert').filter({ hasText: "didn't work" })).toBeVisible();
  await signInWithPassword(page, email, 'brand-new-password');

  // The link only works once.
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible();
});

test('forgot password never reveals whether an account exists', async ({ page }) => {
  await page.goto('/forgot-password');
  await page.getByLabel('Email', { exact: true }).fill('nobody-here@e2e.test');
  await page.getByRole('button', { name: 'Email me a reset link' }).click();
  await expect(page.getByText(/If an account exists/)).toBeVisible();
});
