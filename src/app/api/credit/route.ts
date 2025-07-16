'use server';

import { db } from '@/lib/db';
import type { CreditSale } from '@/lib/types';
import { NextResponse } from 'next/server';

export async function GET() {
  const dbData = await db.read();
  const creditSales = dbData.creditSales;
  return NextResponse.json(creditSales.sort((a,b) => new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime()));
}

export async function POST(request: Request) {
  const newSaleData = await request.json();
  const dbData = await db.read();
  
  const newSale: CreditSale = {
    ...newSaleData,
    id: new Date().toISOString() + Math.random(),
    amountOwed: newSaleData.liters * newSaleData.pricePerLiter,
    status: 'outstanding',
    saleDate: new Date(newSaleData.saleDate),
    expectedPaymentDate: new Date(newSaleData.expectedPaymentDate),
  };
  
  dbData.creditSales.push(newSale);
  await db.write(dbData);
  
  return NextResponse.json(newSale, { status: 201 });
}
