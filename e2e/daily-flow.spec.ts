import { expect, test } from '@playwright/test';
import { E2E_OWNER } from '../playwright.config';
import { formReady, linkFrom, signInWithPassword as signIn, uniqueEmail, waitForMail, signOut } from './helpers';

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

  await page.goto('/customers');
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

  await page.goto('/customers');
  await expect(page.getByText('Customers owe you Ksh 210')).toBeVisible();

  // Her statement shows the sale and the running balance.
  await page.getByRole('link', { name: /Jane Achieng/ }).click();
  await expect(page.getByRole('heading', { name: 'Jane Achieng' })).toBeVisible();
  await expect(page.getByText('Bought 3 L @ Ksh 70, on credit')).toBeVisible();
  await expect(page.getByText('Owes Ksh 210')).toBeVisible();
});

test('owner changes the selling price; the sale form uses it', async ({ page }) => {
  await signIn(page, E2E_OWNER.email, E2E_OWNER.password);
  await page.goto('/settings');
  await formReady(page, 'Save price');
  await page.getByLabel('Selling price / litre').fill('75');
  await page.getByRole('button', { name: 'Save price' }).click();
  await expect(page.getByText('Selling price saved').first()).toBeVisible();

  await page.goto('/sales');
  await page.getByRole('button', { name: 'New sale' }).click();
  await expect(page.getByLabel('Price / litre')).toHaveValue('75.00');

  // Put it back for the other tests.
  await page.goto('/settings');
  await formReady(page, 'Save price');
  await page.getByLabel('Selling price / litre').fill('70');
  await page.getByRole('button', { name: 'Save price' }).click();
  await expect(page.getByText('Selling price saved').first()).toBeVisible();
});

test("an invited attendant records sales and deliveries at the owner's prices only", async ({ page }) => {
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
  await signOut(page);
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
  await expect(page.getByText('Selling at Ksh 70 per litre')).toBeVisible();

  // A sale: litres and payment only; the price is fixed.
  await page.getByRole('button', { name: 'Sale', exact: true }).click();
  await expect(page.getByLabel('Price / litre')).toHaveCount(0);
  await page.getByRole('button', { name: '2 L' }).click();
  await expect(page.getByText('Total: Ksh 140')).toBeVisible();
  await page.getByRole('button', { name: 'Record sale' }).click();
  await expect(page.getByText('Sale recorded').first()).toBeVisible();

  // A delivery: litres only, and no buying price anywhere.
  await page.getByRole('button', { name: 'Delivery in' }).click();
  await expect(page.getByLabel('Cost / litre')).toHaveCount(0);
  await page.getByLabel('Litres received').fill('10');
  await page.getByRole('button', { name: 'Record delivery' }).click();
  await expect(page.getByText('Delivery recorded').first()).toBeVisible();
  await page.goto('/deliveries');
  await expect(page.getByText('10 L').first()).toBeVisible();
  await expect(page.getByText('Ksh 50')).toHaveCount(0);

  // Owner-only pages are out of reach.
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Customers' })).toHaveCount(0);
  for (const path of ['/settings', '/customers', '/suppliers', '/ledger']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/$/);
  }
});

test('owner resends an invite and promotes a team member to owner', async ({ page }) => {
  const email = uniqueEmail('promote');
  await signIn(page, E2E_OWNER.email, E2E_OWNER.password);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Invite' }).click();
  await page.getByLabel('Full name').fill('Rising Star');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByText(email)).toBeVisible();
  const firstLink = linkFrom(await waitForMail(email));

  // Resend from the member's menu: a new email arrives.
  await page.getByRole('button', { name: 'Actions for Rising Star' }).click();
  await page.getByRole('menuitem', { name: 'Resend invite' }).click();
  await expect(page.getByText('Invite sent again to Rising Star').first()).toBeVisible();
  const secondLink = linkFrom(await waitForMail(email, { after: 1 }));
  expect(secondLink).not.toBe(firstLink);

  // Promote to owner (confirm dialog accepted).
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Actions for Rising Star' }).click();
  await page.getByRole('menuitem', { name: 'Make owner' }).click();
  await expect(page.getByText('Rising Star is now an owner').first()).toBeVisible();
  await signOut(page);
  await expect(page).toHaveURL(/\/login/);

  // The first link no longer works; the resent one does.
  await page.goto(firstLink);
  await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible();
  await page.goto(secondLink);
  await formReady(page, 'Save password');
  await page.getByLabel('New password', { exact: true }).fill('rising-star-password');
  await page.getByLabel('Confirm new password').fill('rising-star-password');
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page).toHaveURL(/\/login\?reset=1/);

  // As an owner they can open Settings and see profit.
  await signIn(page, email, 'rising-star-password');
  await expect(page.getByText('Net profit today')).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});
