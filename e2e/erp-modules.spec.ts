import { expect, test } from '@playwright/test';
import { E2E_OWNER } from '../playwright.config';
import { formReady, signInWithPassword } from './helpers';

test('owner adds a product, sells it from the counter, and sees the stock move', async ({ page }) => {
  await signInWithPassword(page, E2E_OWNER.email, E2E_OWNER.password);
  await page.goto('/inventory');
  await page.getByRole('button', { name: 'Product', exact: true }).click();
  await formReady(page, 'Add product');
  await page.getByLabel('Name').fill('Mala 500ml');
  await page.getByLabel('Selling price').fill('60');
  await page.getByRole('button', { name: 'Add product' }).click();
  await expect(page.getByText('Product added').first()).toBeVisible();

  await page.goto('/');
  await page.getByRole('button', { name: 'Sale', exact: true }).click();
  await page.getByRole('radio', { name: 'Mala 500ml' }).click();
  await page.getByRole('button', { name: '2 pcs' }).click();
  await expect(page.getByText('Total: Ksh 120')).toBeVisible();
  await page.getByRole('button', { name: 'Record sale' }).click();
  await expect(page.getByText('Sale recorded').first()).toBeVisible();

  await page.goto('/inventory');
  await expect(page.getByRole('list', { name: 'Stock levels' }).getByRole('listitem').filter({ hasText: 'Mala 500ml' })).toContainText(
    '-2 pcs',
  );
});

test('the shift is counted blind, then the owner signs it off', async ({ page }) => {
  await signInWithPassword(page, E2E_OWNER.email, E2E_OWNER.password);
  await page.getByRole('link', { name: 'Close shift' }).first().click();
  await expect(page).toHaveURL(/\/close$/);
  await formReady(page, 'Close shift');
  await page.getByLabel('Cash in the drawer now').fill('500');
  await page.getByLabel('M-Pesa received this shift').fill('0');
  await page.getByLabel('Milk left (litres)').fill('10');
  await page.getByRole('button', { name: 'Close shift' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Shift (balanced|closed with a difference)/ })).toBeVisible();

  const review = page.getByRole('region', { name: /Close by/ }).first();
  await expect(review).toContainText('Expected');
  await review.getByRole('button', { name: 'Sign off', exact: true }).click();
  await expect(page.getByText('Shift signed off').first()).toBeVisible();
  await expect(page.getByText('Every close is signed off.')).toBeVisible();
});
