import type { LucideIcon } from "lucide-react";

export interface Transaction {
  id: string;
  type: 'delivery' | 'sale' | 'payment' | 'credit-payment';
  date: Date;
  description: string;
  amount: number; // can be liters for delivery/sale, or currency for payment
  value: number; // monetary value
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
