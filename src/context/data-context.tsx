
'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import type { Transaction, CreditSale } from '@/lib/types';

interface DataContextType {
    recentActivity: Transaction[];
    creditData: CreditSale[];
    addTransaction: (newTx: Omit<Transaction, 'id'>) => Promise<void>;
    addCreditSale: (newSale: Omit<CreditSale, 'id' | 'amountOwed' | 'status'>) => Promise<void>;
    loading: boolean;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export function DataProvider({ children }: { children: React.ReactNode }) {
    const [recentActivity, setRecentActivity] = useState<Transaction[]>([]);
    const [creditData, setCreditData] = useState<CreditSale[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchData = async () => {
        try {
            const [activityRes, creditRes] = await Promise.all([
                fetch('/api/transactions'),
                fetch('/api/credit')
            ]);
            const [activity, credit] = await Promise.all([
                activityRes.json(),
                creditRes.json()
            ]);

            setRecentActivity(activity.map((tx: any) => ({...tx, date: new Date(tx.date)})));
            setCreditData(credit.map((sale: any) => ({...sale, saleDate: new Date(sale.saleDate), expectedPaymentDate: new Date(sale.expectedPaymentDate)})));
        } catch (error) {
            console.error("Failed to fetch data:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const addTransaction = async (newTx: Omit<Transaction, 'id'>) => {
        try {
            const response = await fetch('/api/transactions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newTx),
            });
            if (response.ok) {
                // re-fetch all data to ensure consistency
                await fetchData();
            }
        } catch (error) {
            console.error("Failed to add transaction:", error);
        }
    };

    const addCreditSale = async (newSale: Omit<CreditSale, 'id' | 'amountOwed' | 'status'>) => {
         try {
            const creditResponse = await fetch('/api/credit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newSale),
            });

            if(creditResponse.ok) {
                const addedCreditSale = await creditResponse.json();
                // Also add a corresponding transaction for the sale
                await addTransaction({
                    type: 'sale',
                    date: newSale.saleDate,
                    description: `Credit to ${newSale.customerName}`,
                    amount: newSale.liters,
                    value: addedCreditSale.amountOwed
                });
            }

        } catch (error) {
            console.error("Failed to add credit sale:", error);
        }
    };

    const value = {
        recentActivity,
        creditData,
        addTransaction,
        addCreditSale,
        loading
    };

    return (
        <DataContext.Provider value={value}>
            {children}
        </DataContext.Provider>
    );
}

export function useData() {
    const context = useContext(DataContext);
    if (context === undefined) {
        throw new Error('useData must be used within a DataProvider');
    }
    return context;
}
