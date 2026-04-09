'use server';
import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import type { Transaction } from '@/lib/types';

export async function POST(req: Request) {
  const { customerId, amount } = await req.json();
  const dbData = await db.read();
  
  const paymentAmount = Number(amount);
  const cust = dbData.customers?.find(c => c.id === customerId);
  
  if (cust) {
    cust.balance = Math.max(0, cust.balance - paymentAmount);
  }

  const newTx: Transaction = {
    id: 'tx_pay_' + Date.now(),
    type: 'payment',
    date: new Date(),
    description: `Payment from ${cust?.name || 'Walk-in'}`,
    amount: 0,
    value: paymentAmount // Positive cash flow
  };
  
  dbData.transactions = dbData.transactions || [];
  dbData.transactions.push(newTx);
  
  await db.write(dbData);
  return NextResponse.json({ success: true, newBalance: cust?.balance });
}
