/**
 * Outgoing WhatsApp messages through the WhatsApp Business Cloud API (Meta).
 *
 * Messages the shop starts must use a template approved in WhatsApp Manager;
 * free text is only allowed within 24 h of the recipient writing to us. So
 * every message here is a template with text parameters.
 *
 * Without WHATSAPP_ACCESS_TOKEN, development and tests (or WHATSAPP_TRANSPORT=file)
 * write messages to the outbox folder next to emails and log them. In production
 * without credentials, messages are skipped with a warning: notifications are
 * optional, unlike sign-in emails. `fetch` is injectable so tests never touch
 * the network.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { outboxDir } from '../auth/mailer';

type Fetch = typeof fetch;

export interface WhatsAppTemplateMessage {
  /** E.164, e.g. +254712345678 */
  to: string;
  template: string;
  /** Template language code, e.g. "en" or "en_US". */
  language: string;
  /** Body parameters {{1}}, {{2}}, … in order. */
  params: string[];
}

export type SendOutcome = 'sent' | 'outbox' | 'skipped';

/** WhatsApp rejects parameters with new lines, tabs or runs of spaces, and long ones. */
export function cleanParam(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 900 ? `${flat.slice(0, 899)}…` : flat;
}

function writesToOutbox(): boolean {
  if (process.env.WHATSAPP_ACCESS_TOKEN) return false;
  return process.env.WHATSAPP_TRANSPORT === 'file' || process.env.NODE_ENV !== 'production';
}

export async function sendWhatsAppTemplate(msg: WhatsAppTemplateMessage, fetchImpl: Fetch = fetch): Promise<SendOutcome> {
  const params = msg.params.map(cleanParam);
  if (writesToOutbox()) {
    const dir = outboxDir();
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `whatsapp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
    await writeFile(file, JSON.stringify({ ...msg, params, sentAt: new Date().toISOString() }, null, 2));
    console.info(`[whatsapp:outbox] to=${msg.to} template=${msg.template}\n${params.join(' | ')}\n`);
    return 'outbox';
  }

  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    console.warn('[whatsapp] not configured (WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID); message skipped');
    return 'skipped';
  }

  const version = process.env.WHATSAPP_API_VERSION ?? 'v21.0';
  const res = await fetchImpl(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      // The Cloud API wants the number without the leading +.
      to: msg.to.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: msg.template,
        language: { code: msg.language },
        components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }],
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string; code?: number } } | null;
    throw new Error(`WhatsApp API ${res.status}: ${body?.error?.message ?? 'request failed'} (code ${body?.error?.code ?? '?'})`);
  }
  return 'sent';
}
