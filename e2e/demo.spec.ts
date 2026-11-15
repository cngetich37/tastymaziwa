import { expect, test } from '@playwright/test';
import { codeFrom, mailCount, uniqueEmail, waitForMail } from './helpers';

test('a visitor opens the demo shop and tries it as owner, seller and supplier', async ({ page }) => {
  await page.goto('/login');
  const start = page.getByRole('button', { name: 'Try the demo shop' });
  await expect(start).toBeEnabled();
  await start.click();

  // Owner: a shop full of sample trading.
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible({ timeout: 30_000 });
  const banner = page.getByRole('complementary', { name: 'Demo shop' });
  await expect(banner).toBeVisible();
  await expect(banner.getByRole('button', { name: /Owner/ })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/customers');
  await expect(page.getByText('Otieno Juma').first()).toBeVisible();

  // Seller: the milkman's delivery is waiting to be approved.
  await banner.getByRole('button', { name: /Seller/ }).click();
  await expect(banner.getByRole('button', { name: /Seller/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/Waiting for approval/).first()).toBeVisible();

  // Supplier: the milkman's own page.
  await banner.getByRole('button', { name: /Supplier/ }).click();
  await expect(page).toHaveURL(/\/supply$/);
  await expect(page.getByRole('heading', { name: /Habari/ })).toBeVisible();
});

test('signing up from the demo keeps what the visitor added, and nothing else', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Try the demo shop' })).toBeEnabled();
  await page.getByRole('button', { name: 'Try the demo shop' }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible({ timeout: 30_000 });

  // The visitor adds their own customer while trying things out.
  await page.goto('/customers');
  await page.getByRole('button', { name: 'Customer' }).click();
  await page.getByLabel('Name').fill('Wambui Mine');
  await page.getByLabel('Phone (optional)').fill('0711 222 333');
  await page.getByRole('button', { name: 'Add customer' }).click();
  await expect(page.getByText('+254711222333')).toBeVisible();

  await page.getByRole('link', { name: /Create your own shop/ }).click();
  await expect(page.getByRole('heading', { name: 'Create your shop' })).toBeVisible();
  const keep = page.getByRole('checkbox', { name: /Keep what I added in the demo/ });
  await expect(keep).toBeChecked();
  await expect(page.getByText(/1 customer\./)).toBeVisible();

  const email = uniqueEmail('kept');
  await page.getByLabel('Shop name').fill('Wambui Dairy');
  await page.getByLabel('Your name').fill('Wambui');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('kept-password-1');
  const before = mailCount(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Code', { exact: true }).fill(codeFrom(await waitForMail(email, { after: before })));
  await page.getByRole('button', { name: 'Create my shop' }).click();

  // A real shop now: no demo banner, the visitor's customer, no sample ones.
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.getByRole('banner')).toContainText('Wambui Dairy');
  await expect(page.getByRole('complementary', { name: 'Demo shop' })).toHaveCount(0);
  await page.goto('/customers');
  await expect(page.getByText('Wambui Mine').first()).toBeVisible();
  await expect(page.getByText('Otieno Juma')).toHaveCount(0);
});
