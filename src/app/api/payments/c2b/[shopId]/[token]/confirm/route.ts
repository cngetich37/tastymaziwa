import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { C2B_ACCEPT, handleC2bConfirmation } from '@/server/mpesa/c2b';

/**
 * Safaricom confirms each payment made straight to the shop's till or
 * paybill. The URL carries the shop id and a per-shop secret (only its HMAC
 * is stored); the shortcode must be the shop's. Always answers "Accepted".
 */
const MAX_BODY = 64 * 1024;

export async function POST(request: Request, { params }: { params: Promise<{ shopId: string; token: string }> }) {
  const { shopId, token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(shopId) || token.length > 100) return NextResponse.json(C2B_ACCEPT);
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return NextResponse.json(C2B_ACCEPT);
    const outcome = await handleC2bConfirmation(await getDb(), shopId, token, JSON.parse(text));
    if (outcome === 'ignored') console.warn('[c2b] confirmation ignored', { shopId });
  } catch (error) {
    console.error('[c2b] confirmation failed', error);
  }
  return NextResponse.json(C2B_ACCEPT);
}
