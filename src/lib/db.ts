import type { Transaction, CreditSale, Customer, Subscription, Stock } from './types';
import fs from 'fs/promises';
import path from 'path';
import { subDays } from 'date-fns';

interface DbData {
  transactions: Transaction[];
  creditSales: CreditSale[];
  customers: Customer[];
  subscriptions: Subscription[];
  stock: Stock[];
}

const dbPath = path.resolve(process.cwd(), 'src/lib/db.json');

const initialData: DbData = {
  transactions: [],
  creditSales: [],
  customers: [],
  subscriptions: [],
  stock: []
};

// Helper function to make dates relative to today
const makeDatesRelative = (data: DbData): DbData => {
  const today = new Date();
  const mostRecentDate = new Date(Math.max(...data.transactions.map(t => new Date(t.date).getTime())));
  const dayDifference = Math.round((today.getTime() - mostRecentDate.getTime()) / (1000 * 3600 * 24));

  const adjustDate = (dateStr: string) => {
    const originalDate = new Date(dateStr);
    const newDate = new Date(originalDate);
    newDate.setDate(originalDate.getDate() + dayDifference);
    return newDate;
  };

  return {
    transactions: data.transactions.map(tx => ({
      ...tx,
      date: adjustDate(tx.date as unknown as string),
    })),
    creditSales: data.creditSales.map(sale => ({
      ...sale,
      saleDate: adjustDate(sale.saleDate as unknown as string),
      expectedPaymentDate: adjustDate(sale.expectedPaymentDate as unknown as string),
    })),
    customers: data.customers || [],
    subscriptions: (data.subscriptions || []).map(sub => ({
      ...sub,
      startDate: sub.startDate ? adjustDate(sub.startDate as unknown as string) : new Date()
    })),
    stock: (data.stock || []).map(stk => ({
      ...stk,
      date: stk.date ? adjustDate(stk.date as unknown as string) : new Date()
    }))
  };
}


async function readDb(): Promise<DbData> {
  try {
    await fs.access(dbPath);
    const data = await fs.readFile(dbPath, 'utf-8');
    const parsedData = JSON.parse(data);
    
    // Make dates relative before returning
    const relativeData = makeDatesRelative(parsedData);

    // Dates are stored as strings in JSON, so we need to convert them back to Date objects
    return {
      transactions: relativeData.transactions.map((tx: any) => ({ ...tx, date: new Date(tx.date) })),
      creditSales: relativeData.creditSales.map((sale: any) => ({ ...sale, saleDate: new Date(sale.saleDate), expectedPaymentDate: new Date(sale.expectedPaymentDate) })),
      customers: relativeData.customers || [],
      subscriptions: (relativeData.subscriptions || []).map((sub: any) => ({ ...sub, startDate: new Date(sub.startDate) })),
      stock: (relativeData.stock || []).map((stk: any) => ({ ...stk, date: new Date(stk.date) }))
    };
  } catch (error) {
    // If the file doesn't exist, create it with initial data from the updated db.json
    try {
        const initialDbData = await fs.readFile(path.resolve(process.cwd(), 'src/lib/db.json'), 'utf-8');
        const initialJson = JSON.parse(initialDbData)
        await writeDb(initialJson);
        const relativeData = makeDatesRelative(initialJson);
        return {
          transactions: relativeData.transactions.map((tx: any) => ({ ...tx, date: new Date(tx.date) })),
          creditSales: relativeData.creditSales.map((sale: any) => ({ ...sale, saleDate: new Date(sale.saleDate), expectedPaymentDate: new Date(sale.expectedPaymentDate) })),
          customers: relativeData.customers || [],
          subscriptions: (relativeData.subscriptions || []).map((sub: any) => ({ ...sub, startDate: new Date(sub.startDate) })),
          stock: (relativeData.stock || []).map((stk: any) => ({ ...stk, date: new Date(stk.date) }))
        };
    } catch (readError) {
        // if db.json also doesn't exist, use empty data
        await writeDb(initialData);
        return initialData;
    }
  }
}

async function writeDb(data: DbData): Promise<void> {
  await fs.writeFile(dbPath, JSON.stringify(data, null, 2), 'utf-8');
}

export const db = {
  read: readDb,
  write: writeDb,
};
