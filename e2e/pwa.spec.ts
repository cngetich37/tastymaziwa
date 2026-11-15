import { expect, test } from '@playwright/test';
import { E2E_OWNER } from '../playwright.config';
import { signInWithPassword } from './helpers';

test('the app is installable: manifest, icons and service worker load signed out', async ({ page, request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.status()).toBe(200);
  const manifest = await res.json();
  expect(manifest).toMatchObject({ name: 'TastyMaziwa', start_url: '/', scope: '/', display: 'standalone' });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'any' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
    ]),
  );
  for (const icon of manifest.icons as { src: string }[]) {
    const img = await request.get(icon.src);
    expect(img.status(), icon.src).toBe(200);
    expect(img.headers()['content-type']).toContain('image/png');
  }

  const sw = await request.get('/sw.js');
  expect(sw.status()).toBe(200);
  expect(sw.headers()['cache-control']).toContain('no-cache');

  await page.goto('/login');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /manifest\.webmanifest/);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icons/apple-touch-icon.png');
});

test('with no connection the installed app shows a friendly offline screen, not an error', async ({ page, context }) => {
  await signInWithPassword(page, E2E_OWNER.email, E2E_OWNER.password);
  // The service worker installs (caching the offline screen) and takes control.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(true);
  await page.goto('/sales');
  await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
  // No shop data is kept on the phone: the offline screen is all there is.
  await expect(page.getByText('E2E Dairy')).toHaveCount(0);

  await context.setOffline(false);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Sales' })).toBeVisible();
});
