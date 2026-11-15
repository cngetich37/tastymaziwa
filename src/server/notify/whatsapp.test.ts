import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanParam, sendWhatsAppTemplate } from './whatsapp';

const msg = { to: '+254712345678', template: 'stock_update', language: 'en', params: ['Shop A', 'line\none\t  two'] };

afterEach(() => vi.unstubAllEnvs());

describe('cleanParam', () => {
  it('flattens new lines, tabs and runs of spaces, and caps the length', () => {
    expect(cleanParam(' a\nb\t\tc     d ')).toBe('a b c d');
    expect(cleanParam('x'.repeat(2000))).toHaveLength(900);
  });
});

describe('sendWhatsAppTemplate', () => {
  it('posts a template message to the Cloud API', async () => {
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', 'token-123');
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '555');
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    expect(await sendWhatsAppTemplate(msg, fetchImpl)).toBe('sent');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v21.0/555/messages');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-123');
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: 'whatsapp',
      to: '254712345678',
      type: 'template',
      template: {
        name: 'stock_update',
        language: { code: 'en' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Shop A' }, { type: 'text', text: 'line one two' }] }],
      },
    });
  });

  it('throws with the API error so the caller can log it', async () => {
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', 'token-123');
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '555');
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: { message: 'Template name does not exist', code: 132001 } }, { status: 404 }),
    );
    await expect(sendWhatsAppTemplate(msg, fetchImpl)).rejects.toThrow(/Template name does not exist.*132001/);
  });

  it('skips in production without credentials', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', '');
    vi.stubEnv('WHATSAPP_TRANSPORT', '');
    const fetchImpl = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await sendWhatsAppTemplate(msg, fetchImpl)).toBe('skipped');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
