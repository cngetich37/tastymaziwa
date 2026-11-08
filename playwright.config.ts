import { defineConfig, devices } from '@playwright/test';

const PORT = 9003;
export const E2E_OWNER = { username: 'owner', password: 'e2e-owner-password' };

/**
 * End-to-end tests against a production build (`npm run build` first) with a
 * fresh, seeded PGlite database in .data/e2e.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // one embedded database, one worker
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  // A phone-sized viewport: this app is used behind the counter on Android.
  projects: [{ name: 'mobile-chrome', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: `node -e "require('fs').rmSync('.data/e2e',{recursive:true,force:true})" && npx tsx scripts/seed.mts && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PGLITE_DIR: '.data/e2e',
      SEED_OWNER_USERNAME: E2E_OWNER.username,
      SEED_OWNER_PASSWORD: E2E_OWNER.password,
      AUTH_SECRET: 'e2e-only-secret-not-for-production-use',
      AUTH_TRUST_HOST: 'true',
    },
  },
});
