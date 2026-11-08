import { defineConfig, devices } from '@playwright/test';

export const E2E_OWNER = { email: 'owner@e2e.test', password: 'e2e-owner-password' };
export const OUTBOX = { main: '.data/e2e/outbox', expiry: '.data/e2e-expiry/outbox' };
export const EXPIRY_IDLE_SECONDS = 5;

const PORT = 9003;
const EXPIRY_PORT = 9005;

/** A fresh, seeded PGlite database + `next start` (run `npm run build` first). */
function server(port: number, dir: string, outbox: string, env: Record<string, string> = {}) {
  return {
    command: `node -e "require('fs').rmSync('${dir}',{recursive:true,force:true})" && npx tsx scripts/seed.mts && npx next start -p ${port}`,
    url: `http://localhost:${port}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PGLITE_DIR: `${dir}/db`,
      SEED_OWNER_EMAIL: E2E_OWNER.email,
      SEED_OWNER_PASSWORD: E2E_OWNER.password,
      SEED_SHOP_NAME: 'E2E Dairy',
      AUTH_SECRET: 'e2e-only-secret-not-for-production-use',
      AUTH_TRUST_HOST: 'true',
      APP_URL: `http://localhost:${port}`,
      // Production build, but emails go to a folder the tests can read.
      EMAIL_TRANSPORT: 'file',
      EMAIL_OUTBOX_DIR: outbox,
      ...env,
    },
  };
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // one embedded database per server, one worker
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
  // A phone-sized viewport: this app is used behind the counter on Android.
  projects: [
    {
      name: 'mobile-chrome',
      testIgnore: /session-expiry/,
      use: { ...devices['Pixel 7'], baseURL: `http://localhost:${PORT}` },
    },
    {
      name: 'session-expiry',
      testMatch: /session-expiry/,
      use: { ...devices['Pixel 7'], baseURL: `http://localhost:${EXPIRY_PORT}` },
    },
  ],
  webServer: [
    server(PORT, '.data/e2e', OUTBOX.main),
    server(EXPIRY_PORT, '.data/e2e-expiry', OUTBOX.expiry, {
      SESSION_IDLE_SECONDS: String(EXPIRY_IDLE_SECONDS),
    }),
  ],
});
