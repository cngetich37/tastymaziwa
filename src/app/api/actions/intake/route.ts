'use server';
import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import type { Stock, Transaction } from '@/lib/types';

export async function POST(req: Request) {
  const { liters, spoilage, costPerLiter } = await req.json();
  const dbData = await db.read();
  
  const newStock: Stock = {
    id: 'stk_' + Date.now(),
    date: new Date(),
    intakeLiters: Number(liters),
    spoiledLiters: Number(spoilage || 0)
  };
  
  const cost = Number(liters) * Number(costPerLiter);
  const newTx: Transaction = {
    id: 'tx_purchase_' + Date.now(),
    type: 'purchase',
    date: new Date(),
    description: `Morning Intake: ${liters}L`,
    amount: Number(liters),
    value: -cost // Negative cash flow
  };

  dbData.stock = dbData.stock || [];
  dbData.transactions = dbData.transactions || [];
  dbData.stock.push(newStock);
  if (cost > 0) dbData.transactions.push(newTx);
  
  await db.write(dbData);
  return NextResponse.json({ success: true, stock: newStock });
}
