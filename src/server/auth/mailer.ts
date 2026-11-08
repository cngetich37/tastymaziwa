/**
 * Outgoing email. SMTP (Nodemailer) when SMTP_HOST is set; otherwise, outside
 * production (or with EMAIL_TRANSPORT=file), messages are written to an outbox
 * folder and logged, so development and tests need no mail account.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Transporter } from 'nodemailer';

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

let transporter: Transporter | undefined;

async function smtp(): Promise<Transporter> {
  if (transporter) return transporter;
  const { createTransport } = await import('nodemailer');
  const port = Number(process.env.SMTP_PORT ?? 587);
  transporter = createTransport({
    host: process.env.SMTP_HOST,
    port,
    // Port 465 is implicit TLS; 587 upgrades with STARTTLS.
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    // Hardening: never let message content pull in local files or URLs.
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return transporter;
}

function writesToOutbox(): boolean {
  if (process.env.SMTP_HOST) return false;
  return process.env.EMAIL_TRANSPORT === 'file' || process.env.NODE_ENV !== 'production';
}

export function outboxDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.EMAIL_OUTBOX_DIR ?? '.data/outbox');
}

export async function sendEmail(email: Email): Promise<void> {
  if (writesToOutbox()) {
    const dir = outboxDir();
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
    await writeFile(file, JSON.stringify({ ...email, sentAt: new Date().toISOString() }, null, 2));
    console.info(`[email:outbox] to=${email.to} subject="${email.subject}"\n${email.text}\n`);
    return;
  }
  if (!process.env.SMTP_HOST) {
    // Fail loudly in production rather than silently dropping a reset email.
    throw new Error('Email is not configured: set SMTP_HOST, SMTP_USER, SMTP_PASS and EMAIL_FROM');
  }
  const from = process.env.EMAIL_FROM ?? process.env.SMTP_USER;
  await (await smtp()).sendMail({ from, ...email });
}
