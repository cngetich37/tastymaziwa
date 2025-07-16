
'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import type { Transaction, CreditSale } from '@/lib/types';
import { getDashboardData } from '@/lib/data';

interface DataContextType {
    recentActivity: Transaction[];
    creditData: CreditSale[];
    addTransaction: (newTx: Omit<Transaction, 'id'>) => void;
    addCreditSale: (newSale: Omit<CreditSale, 'id' | 'amountOwed' | 'status'>) => void;
    loading: boolean;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export function DataProvider({ children }: { children: React.ReactNode }) {
    const [recentActivity, setRecentActivity] = useState<Transaction[]>([]);
    const [creditData, setCreditData] = useState<CreditSale[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            const { recentActivity: initialActivity, creditData: initialCredit } = await getDashboardData();
            setRecentActivity(initialActivity);
            setCreditData(initialCredit);
            setLoading(false);
        }
        fetchData();
    }, []);

    const addTransaction = (newTx: Omit<Transaction, 'id'>) => {
        const txWithId = { ...newTx, id: new Date().toISOString() + Math.random() };
        setRecentActivity(prev => [txWithId, ...prev].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    };

    const addCreditSale = (newSale: Omit<CreditSale, 'id' | 'amountOwed' | 'status'>) => {
        const saleWithId: CreditSale = { 
            ...newSale, 
            id: new Date().toISOString() + Math.random(),
            amountOwed: newSale.liters * newSale.pricePerLiter,
            status: 'outstanding'
        };
        setCreditData(prev => [saleWithId, ...prev]);
        addTransaction({
            type: 'sale',
            date: newSale.saleDate,
            description: `Credit to ${newSale.customerName}`,
            amount: newSale.liters,
            value: saleWithId.amountOwed
        });
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
