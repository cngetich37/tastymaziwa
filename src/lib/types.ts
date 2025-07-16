import type { LucideIcon } from "lucide-react";

export interface Transaction {
  id: string;
  type: 'delivery' | 'sale' | 'payment' | 'credit-payment';
  date: Date;
  description: string;
  amount: number; // For delivery/sale/payment, this is in liters. For credit-payment, it's currency.
  value: number; // The monetary value of the transaction. Typically positive for sales, negative for costs/payments.
}

export interface CreditSale {
  id: string;
  customerName: string;
  liters: number;
  pricePerLiter: number;
  amountOwed: number;
  saleDate: Date;
  expectedPaymentDate: Date;
  status: 'outstanding' | 'paid';
}

export interface Stat {
  key: string;
  label: string;
  value: string;
  change?: string;
  changeType?: 'increase' | 'decrease';
  icon: keyof typeof import("lucide-react");
}

export interface ProfitData {
  date: string;
  profit: number;
}
