/**
 * Runs against a server with SESSION_IDLE_SECONDS=5 (see playwright.config.ts)
 * so the real expiry behaviour can be tested in seconds instead of 30 minutes.
 */
import { expect, test } from '@playwright/test';
import { E2E_OWNER, EXPIRY_IDLE_SECONDS } from '../playwright.config';
import { signInWithPassword } from './helpers';

test('an idle session expires and asks you to sign in again', async ({ page, context }) => {
  await signInWithPassword(page, E2E_OWNER.email, E2E_OWNER.password);

  // Do nothing: the browser-side timer signs the tab out…
  await expect(page).toHaveURL(/\/login\?reason=expired/, { timeout: (EXPIRY_IDLE_SECONDS + 10) * 1000 });
  await expect(page.getByText('Your session expired. Please sign in again.')).toBeVisible();

  // …and the server agrees: the session cookie no longer opens any page.
  const fresh = await context.newPage();
  await fresh.goto('/credit');
  await expect(fresh).toHaveURL(/\/login/);
});

test('activity keeps the session alive past the idle timeout', async ({ page }) => {
  await signInWithPassword(page, E2E_OWNER.email, E2E_OWNER.password);
  // Navigate every 2s for ~2x the idle timeout: each request slides the expiry.
  for (let elapsed = 0; elapsed < EXPIRY_IDLE_SECONDS * 2000; elapsed += 2000) {
    await page.waitForTimeout(2000);
    await page.getByRole('link', { name: elapsed % 4000 ? 'Today' : 'Ledger' }).first().click();
  }
  await expect(page).not.toHaveURL(/\/login/);
});

test('the server expires an idle session even with no tab open', async ({ page, context }) => {
  await signInWithPassword(page, E2E_OWNER.email, E2E_OWNER.password);
  // Close the tab so no browser-side timer runs; only the server can expire it.
  await page.close();
  await new Promise((r) => setTimeout(r, (EXPIRY_IDLE_SECONDS + 2) * 1000));

  const later = await context.newPage();
  await later.goto('/ledger');
  await expect(later).toHaveURL(/\/login/);
});
