'use server';
import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import type { Transaction } from '@/lib/types';

export async function POST() {
  const dbData = await db.read();
  const activeSubs = (dbData.subscriptions || []).filter(s => s.status === 'active');
  
  let totalLiters = 0;
  let totalBilled = 0;

  activeSubs.forEach(sub => {
    const cust = dbData.customers?.find(c => c.id === sub.customerId);
    if (cust) {
      const billed = Number(sub.dailyLiters) * Number(sub.pricePerLiter);
      cust.balance += billed;
      totalLiters += Number(sub.dailyLiters);
      totalBilled += billed;
    }
  });

  const newTx: Transaction = {
    id: 'tx_sub_' + Date.now(),
    type: 'delivery',
    date: new Date(),
    description: `Processed ${activeSubs.length} Subscriptions`,
    amount: totalLiters,
    value: totalBilled // Accrued value, not cash
  };
  
  dbData.transactions = dbData.transactions || [];
  if (totalLiters > 0) dbData.transactions.push(newTx);
  await db.write(dbData);

  return NextResponse.json({ success: true, totalLiters, totalBilled });
}
