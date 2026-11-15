import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { handleMpesaCallback } from '@/server/mpesa/payments';

/**
 * Safaricom posts the outcome of each STK Push here. The URL carries the
 * request id and a per-request secret (only its HMAC is stored); the handler
 * also checks the CheckoutRequestID and the amount before anything is posted.
 * Always answers "Accepted" so Safaricom doesn't retry forged or stale calls.
 */
const ACCEPTED = { ResultCode: 0, ResultDesc: 'Accepted' };
const MAX_BODY = 64 * 1024;

export async function POST(request: Request, { params }: { params: Promise<{ id: string; token: string }> }) {
  const { id, token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || token.length > 100) return NextResponse.json(ACCEPTED);
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return NextResponse.json(ACCEPTED);
    const outcome = await handleMpesaCallback(await getDb(), id, token, JSON.parse(text));
    if (outcome === 'ignored') console.warn('[mpesa] callback ignored', { id });
  } catch (error) {
    console.error('[mpesa] callback failed', error);
  }
  return NextResponse.json(ACCEPTED);
}
