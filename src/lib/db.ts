import type { Transaction, CreditSale } from './types';
import fs from 'fs/promises';
import path from 'path';

interface DbData {
  transactions: Transaction[];
  creditSales: CreditSale[];
}

const dbPath = path.resolve(process.cwd(), 'src/lib/db.json');

const initialData: DbData = {
  transactions: [],
  creditSales: []
};


async function readDb(): Promise<DbData> {
  try {
    await fs.access(dbPath);
    const data = await fs.readFile(dbPath, 'utf-8');
    const parsedData = JSON.parse(data);
    // Dates are stored as strings in JSON, so we need to convert them back to Date objects
    return {
      transactions: parsedData.transactions.map((tx: any) => ({ ...tx, date: new Date(tx.date) })),
      creditSales: parsedData.creditSales.map((sale: any) => ({ ...sale, saleDate: new Date(sale.date), expectedPaymentDate: new Date(sale.expectedPaymentDate) }))
    };
  } catch (error) {
    // If the file doesn't exist, create it with initial data from the updated db.json
    try {
        const initialDbData = await fs.readFile(path.resolve(process.cwd(), 'src/lib/db.json'), 'utf-8');
        const initialJson = JSON.parse(initialDbData)
        await writeDb(initialJson);
        return initialJson;
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
