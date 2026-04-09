'use server';
import { db } from '@/lib/db';
import type { Stock } from '@/lib/types';
import { NextResponse } from 'next/server';

export async function GET() {
  const dbData = await db.read();
  return NextResponse.json((dbData.stock || []).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
}

export async function POST(request: Request) {
  const newStockData = await request.json();
  const dbData = await db.read();
  
  const newStock: Stock = {
    ...newStockData,
    id: new Date().toISOString() + Math.random().toString(),
    date: new Date(newStockData.date || new Date()),
  };
  
  dbData.stock = dbData.stock || [];
  dbData.stock.push(newStock);
  await db.write(dbData);
  
  return NextResponse.json(newStock, { status: 201 });
}
