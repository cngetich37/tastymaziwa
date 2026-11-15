import { afterEach, describe, expect, it, vi } from 'vitest';
import { loginCodeEmail, signupCodeEmail } from './emails';

describe('email layout', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('shows the churn logo from the app URL next to the wordmark', () => {
    vi.stubEnv('APP_URL', 'https://shop.example/');
    for (const email of [signupCodeEmail('a@b.c', '123456', 15), loginCodeEmail('a@b.c', '654321', 10)]) {
      expect(email.html).toContain('<img src="https://shop.example/icons/email-logo.png" width="32" height="32"');
      expect(email.html).toContain('>TastyMaziwa</td>');
      expect(email.html).not.toContain('🥛');
    }
  });
});
