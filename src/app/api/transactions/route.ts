'use server';

import { db } from '@/lib/db';
import type { Transaction } from '@/lib/types';
import { NextResponse } from 'next/server';

export async function GET() {
  const dbData = await db.read();
  const transactions = dbData.transactions;
  return NextResponse.json(transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
}

export async function POST(request: Request) {
  const newTxData = await request.json();
  const dbData = await db.read();
  
  const newTx: Transaction = {
    ...newTxData,
    id: new Date().toISOString() + Math.random(),
    date: new Date(newTxData.date),
  };
  
  dbData.transactions.push(newTx);
  await db.write(dbData);
  
  return NextResponse.json(newTx, { status: 201 });
}
