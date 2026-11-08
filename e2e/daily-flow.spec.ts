import { expect, test } from '@playwright/test';
import { E2E_OWNER } from '../playwright.config';
import { formReady, linkFrom, signInWithPassword as signIn, uniqueEmail, waitForMail } from './helpers';

test('signed-out visitors are sent to the login page', async ({ page }) => {
  await page.goto('/credit');
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fcredit/);
});

test('wrong password is rejected', async ({ page }) => {
  await page.goto('/login');
  await formReady(page, 'Sign in');
  await page.getByLabel('Email', { exact: true }).fill(E2E_OWNER.email);
  await page.getByLabel('Password', { exact: true }).fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert').filter({ hasText: "didn't work" })).toBeVisible();
});

test('cron endpoint refuses requests without the secret', async ({ request }) => {
  const res = await request.get('/api/cron/bill-subscriptions');
  expect([401, 503]).toContain(res.status());
});

test('owner records a delivery and a cash sale, then reverses the sale', async ({ page }) => {
  await signIn(page, E2E_OWNER.email, E2E_OWNER.password);
  const stats = page.getByRole('region', { name: "Today's figures" });

  // Delivery: 40 L at the supplier's default KSh 50.
  await page.getByRole('button', { name: 'Delivery in' }).click();
  await page.getByLabel('Litres received').fill('40');
  await page.getByRole('button', { name: 'Record delivery' }).click();
  await expect(page.getByText('Delivery recorded').first()).toBeVisible();
  await expect(stats).toContainText('40 L');

  // Sale: 2.5 L at KSh 70, paid by M-Pesa.
  await page.getByRole('button', { name: 'Sale', exact: true }).click();
  await page.getByLabel('Litres').fill('2.5');
  await page.getByLabel('Price / litre').fill('70');
  await page.getByRole('radio', { name: 'M-Pesa' }).click();
  await expect(page.getByText('Total: Ksh 175')).toBeVisible();
  await page.getByRole('button', { name: 'Record sale' }).click();
  await expect(page.getByText('Sale recorded').first()).toBeVisible();
  await expect(stats).toContainText('Ksh 175');
  await expect(stats).toContainText('37.5 L'); // 40 − 2.5 left in stock

  // Reverse the sale from recent activity.
  await page.getByRole('button', { name: 'Reverse' }).first().click();
  await page.getByLabel('Reason').fill('Recorded by mistake');
  await page.getByRole('button', { name: 'Reverse entry' }).click();
  await expect(page.getByText('Entry reversed').first()).toBeVisible();
  await expect(stats).toContainText('40 L');
  await expect(page.getByText('Reversed', { exact: true })).toBeVisible();
});

test('credit sales show up as money owed', async ({ page }) => {
  await signIn(page, E2E_OWNER.email, E2E_OWNER.password);

  await page.goto('/credit');
  await page.getByRole('button', { name: 'Customer' }).click();
  await page.getByLabel('Name').fill('Jane Achieng');
  await page.getByLabel('Phone (optional)').fill('0712 345 678');
  await page.getByRole('button', { name: 'Add customer' }).click();
  await expect(page.getByText('+254712345678')).toBeVisible();

  await page.goto('/');
  await page.getByRole('button', { name: 'Sale', exact: true }).click();
  await page.getByLabel('Litres').fill('3');
  await page.getByLabel('Price / litre').fill('70');
  await page.getByRole('radio', { name: 'Credit (deni)' }).click();
  await page.getByRole('combobox', { name: 'Customer' }).click();
  await page.getByRole('option', { name: 'Jane Achieng' }).click();
  await page.getByRole('button', { name: 'Record sale' }).click();
  await expect(page.getByText('Sale recorded').first()).toBeVisible();

  await page.goto('/credit');
  await expect(page.getByText('Customers owe you Ksh 210')).toBeVisible();
});

test('an invited attendant sets a password and cannot open settings', async ({ page }) => {
  const email = uniqueEmail('attendant');
  // The owner invites them by email.
  await signIn(page, E2E_OWNER.email, E2E_OWNER.password);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Invite' }).click();
  await page.getByLabel('Full name').fill('Counter Staff');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText('Invited', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);

  // They follow the link in the invite email and choose a password.
  await page.goto(linkFrom(await waitForMail(email)));
  await expect(page.getByRole('heading', { name: 'Welcome! Set your password' })).toBeVisible();
  await formReady(page, 'Save password');
  await page.getByLabel('New password', { exact: true }).fill('attendant-password');
  await page.getByLabel('Confirm new password').fill('attendant-password');
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page).toHaveURL(/\/login\?reset=1/);

  await signIn(page, email, 'attendant-password');
  await expect(page.getByRole('banner')).toContainText('E2E Dairy');
  await expect(page.getByText('Net profit today')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/$/);
});
