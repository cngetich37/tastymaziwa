import type { Transaction, CreditSale } from './types';
import fs from 'fs/promises';
import path from 'path';

interface DbData {
  transactions: Transaction[];
  creditSales: CreditSale[];
}

const dbPath = path.resolve(process.cwd(), 'src/lib/db.json');

const initialData: DbData = {
  transactions: [
    { id: '1', type: 'delivery', date: new Date(new Date().setDate(new Date().getDate() - 1)), description: 'Milk delivery', amount: 50, value: -1750 },
    { id: '2', type: 'sale', date: new Date(new Date().setDate(new Date().getDate() - 1)), description: 'Cash sale', amount: 45, value: 2700 },
    { id: '3', type: 'delivery', date: new Date(), description: 'Milk delivery', amount: 55, value: -1925 },
    { id: '4', type: 'sale', date: new Date(), description: 'Credit to J. Doe', amount: 10, value: 650 },
  ],
  creditSales: [
    { id: 'credit1', customerName: 'John Doe', liters: 10, pricePerLiter: 65, amountOwed: 650, saleDate: new Date(), expectedPaymentDate: new Date(new Date().setDate(new Date().getDate() + 7)), status: 'outstanding' },
    { id: 'credit2', customerName: 'Jane Smith', liters: 5, pricePerLiter: 65, amountOwed: 325, saleDate: new Date(new Date().setDate(new Date().getDate() - 2)), expectedPaymentDate: new Date(new Date().setDate(new Date().getDate() + 5)), status: 'outstanding' },
    { id: 'credit3', customerName: 'Peter Jones', liters: 8, pricePerLiter: 60, amountOwed: 480, saleDate: new Date(new Date().setDate(new Date().getDate() - 5)), expectedPaymentDate: new Date(new Date().setDate(new Date().getDate() + 2)), status: 'paid' },
  ]
};


async function readDb(): Promise<DbData> {
  try {
    await fs.access(dbPath);
    const data = await fs.readFile(dbPath, 'utf-8');
    const parsedData = JSON.parse(data);
    // Dates are stored as strings in JSON, so we need to convert them back to Date objects
    return {
      transactions: parsedData.transactions.map((tx: any) => ({ ...tx, date: new Date(tx.date) })),
      creditSales: parsedData.creditSales.map((sale: any) => ({ ...sale, saleDate: new Date(sale.saleDate), expectedPaymentDate: new Date(sale.expectedPaymentDate) }))
    };
  } catch (error) {
    // If the file doesn't exist, create it with initial data
    await writeDb(initialData);
    return initialData;
  }
}

async function writeDb(data: DbData): Promise<void> {
  await fs.writeFile(dbPath, JSON.stringify(data, null, 2), 'utf-8');
}

export const db = {
  read: readDb,
  write: writeDb,
};
