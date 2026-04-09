'use server';
import { db } from '@/lib/db';
import type { Subscription } from '@/lib/types';
import { NextResponse } from 'next/server';

export async function GET() {
  const dbData = await db.read();
  return NextResponse.json((dbData.subscriptions || []).sort((a,b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()));
}

export async function POST(request: Request) {
  const newSubData = await request.json();
  const dbData = await db.read();
  
  const newSub: Subscription = {
    ...newSubData,
    id: new Date().toISOString() + Math.random().toString(),
    startDate: new Date(newSubData.startDate || new Date()),
    status: newSubData.status || 'active',
  };
  
  dbData.subscriptions = dbData.subscriptions || [];
  dbData.subscriptions.push(newSub);
  await db.write(dbData);
  
  return NextResponse.json(newSub, { status: 201 });
}
