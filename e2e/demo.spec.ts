import { expect, test } from '@playwright/test';

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

  // Ready to sign up for real: leaves the demo.
  await page.getByRole('button', { name: /Create your own shop/ }).click();
  await expect(page).toHaveURL(/\/signup/);
  await expect(page.getByRole('heading', { name: 'Create your shop' })).toBeVisible();
});
