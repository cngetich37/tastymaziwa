import { NextResponse } from 'next/server';
import { C2B_ACCEPT } from '@/server/mpesa/c2b';

/** Safaricom asks before completing a payment; the shop never refuses money. */
export function POST() {
  return NextResponse.json(C2B_ACCEPT);
}
