import { expect, test, type Page } from '@playwright/test';
import { E2E_OWNER } from '../playwright.config';
import { formReady, linkFrom, signInWithPassword, uniqueEmail, waitForMail, signOut } from './helpers';

/** Suppliers land on their own page, not Today. */
async function signInSupplier(page: Page, email: string, password: string) {
  await page.goto('/login');
  await formReady(page, 'Sign in');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/supply$/);
  await expect(page.getByRole('heading', { name: /Habari/ })).toBeVisible();
}

async function supplierSignOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
}

async function recordAsSupplier(page: Page, litres: string) {
  await formReady(page, 'Send for approval');
  await page.getByLabel('Litres delivered').fill(litres);
  await page.getByRole('button', { name: 'Send for approval' }).click();
  await expect(page.getByText('Sent to the shop for approval').first()).toBeVisible();
}

test('a supplier records deliveries, the seller approves or rejects them, and the owner reports on it', async ({ page }) => {
  const email = uniqueEmail('milkman');

  // The owner adds a supplier and gives them a login.
  await signInWithPassword(page, E2E_OWNER.email, E2E_OWNER.password);
  await page.goto('/suppliers');
  await page.getByRole('button', { name: 'Supplier' }).click();
  await page.getByLabel('Name').fill('Zawadi Farm');
  await page.getByLabel('Agreed price / litre').fill('55');
  await page.getByRole('button', { name: 'Add supplier' }).click();
  await expect(page.getByText('Supplier added').first()).toBeVisible();
  await page.getByRole('link', { name: /Zawadi Farm/ }).click();
  await page.getByRole('button', { name: 'Give them a login' }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByText('Invite sent').first()).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await signOut(page);

  // The milkman sets a password and records two deliveries.
  await page.goto(linkFrom(await waitForMail(email)));
  await formReady(page, 'Save password');
  await page.getByLabel('New password', { exact: true }).fill('milkman-password');
  await page.getByLabel('Confirm new password').fill('milkman-password');
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page).toHaveURL(/\/login\?reset=1/);
  await signInSupplier(page, email, 'milkman-password');
  await recordAsSupplier(page, '30');
  await recordAsSupplier(page, '25');
  await expect(page.getByText('Waiting', { exact: true })).toHaveCount(2);

  // Shop pages are out of reach for a supplier login.
  for (const path of ['/', '/deliveries', '/settings', '/reports', '/account']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/supply$/);
  }
  await supplierSignOut(page);

  // The shop checks them: approve one, reject the other with a reason.
  await signInWithPassword(page, E2E_OWNER.email, E2E_OWNER.password);
  const waiting = page.getByRole('region', { name: 'Deliveries waiting for approval' });
  await expect(waiting).toContainText('Waiting for approval · 55 L');
  const stock = page.getByRole('region', { name: "Today's figures" }).getByText('Milk in stock').locator('..');
  const stockBefore = await stock.textContent();

  await waiting.getByRole('listitem').filter({ hasText: '30 L' }).getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('30 L from Zawadi Farm approved').first()).toBeVisible();

  await waiting.getByRole('listitem').filter({ hasText: '25 L' }).getByRole('button', { name: 'Reject' }).click();
  await page.getByLabel('What was wrong?').fill('Only 20 L arrived');
  await page.getByRole('button', { name: 'Reject delivery' }).click();
  await expect(page.getByText('Delivery sent back to the supplier').first()).toBeVisible();
  await expect(waiting).toHaveCount(0);
  await expect(stock).not.toHaveText(stockBefore ?? '');

  // Reports: the approvals log shows both decisions, and exports as CSV.
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  const reports = page.getByRole('navigation', { name: 'Choose a report' });
  await reports.getByRole('link', { name: 'Delivery approvals' }).click();
  await expect(page).toHaveURL(/type=approvals/);
  await page.getByRole('region', { name: 'Choose a period' }).getByRole('link', { name: 'Today', exact: true }).click();
  await expect(page).toHaveURL(/type=approvals&range=today/);
  const log = page.getByRole('table');
  await expect(log).toContainText('Zawadi Farm');
  await expect(log).toContainText('approved');
  await expect(log).toContainText('Only 20 L arrived');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^approvals-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);

  await reports.getByRole('link', { name: 'Deliveries', exact: true }).click();
  await expect(page).toHaveURL(/type=deliveries&range=today/);
  await expect(page.getByRole('row', { name: /Zawadi Farm/ })).toContainText('30 L');
  await signOut(page);

  // The milkman sees the decision and the reason.
  await signInSupplier(page, email, 'milkman-password');
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  await expect(page.getByText('“Only 20 L arrived”', { exact: false })).toBeVisible();
  await expect(page.getByText('Ksh 1,650').first()).toBeVisible(); // 30 L × 55 owed to them
});
