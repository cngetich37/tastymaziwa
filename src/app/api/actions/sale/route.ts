'use server';
import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import type { Transaction, CreditSale } from '@/lib/types';

export async function POST(req: Request) {
  const { customerId, liters, pricePerLiter, isCredit } = await req.json();
  const dbData = await db.read();
  
  const amount = Number(liters);
  const total = amount * Number(pricePerLiter);

  if (isCredit) {
    const cust = dbData.customers?.find(c => c.id === customerId);
    let custName = 'Walk-in (Credit)';
    if (cust) {
      cust.balance += total;
      custName = cust.name;
    }
    const newCredit: CreditSale = {
      id: 'cr_' + Date.now(),
      customerName: custName,
      liters: amount,
      pricePerLiter: Number(pricePerLiter),
      amountOwed: total,
      saleDate: new Date(),
      expectedPaymentDate: new Date(Date.now() + 7 * 86400000), // +7 days default
      status: 'outstanding'
    };
    dbData.creditSales = dbData.creditSales || [];
    dbData.creditSales.push(newCredit);
  } else {
    // Cash sale
    const newTx: Transaction = {
      id: 'tx_sale_' + Date.now(),
      type: 'sale',
      date: new Date(),
      description: `Retail Sale: ${liters}L`,
      amount: amount,
      value: total // Positive cash flow
    };
    dbData.transactions = dbData.transactions || [];
    dbData.transactions.push(newTx);
  }
  
  await db.write(dbData);
  return NextResponse.json({ success: true });
}
