'use server';
import { db } from '@/lib/db';
import type { Customer } from '@/lib/types';
import { NextResponse } from 'next/server';

export async function GET() {
  const dbData = await db.read();
  return NextResponse.json(dbData.customers || []);
}

export async function POST(request: Request) {
  const newCustomerData = await request.json();
  const dbData = await db.read();
  
  const newCustomer: Customer = {
    ...newCustomerData,
    id: new Date().toISOString() + Math.random().toString(),
    balance: newCustomerData.balance || 0,
  };
  
  dbData.customers = dbData.customers || [];
  dbData.customers.push(newCustomer);
  await db.write(dbData);
  
  return NextResponse.json(newCustomer, { status: 201 });
}
