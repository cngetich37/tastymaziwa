import type { Stat, ProfitData, Transaction, CreditSale } from '@/lib/types';

// Mock data
const mockTransactions: Transaction[] = [
  { id: '1', type: 'delivery', date: new Date(new Date().setDate(new Date().getDate() - 1)), description: 'Milk delivery', amount: 50, value: -1750 },
  { id: '2', type: 'sale', date: new Date(new Date().setDate(new Date().getDate() - 1)), description: 'Cash sale', amount: 45, value: 2700 },
  { id: '3', type: 'delivery', date: new Date(), description: 'Milk delivery', amount: 55, value: -1925 },
  { id: '4', type: 'sale', date: new Date(), description: 'Credit sale to J. Doe', amount: 10, value: 650 },
];

const mockCreditSales: CreditSale[] = [
    { id: 'credit1', customerName: 'John Doe', liters: 10, pricePerLiter: 65, amountOwed: 650, saleDate: new Date(), expectedPaymentDate: new Date(new Date().setDate(new Date().getDate() + 7)), status: 'outstanding' },
    { id: 'credit2', customerName: 'Jane Smith', liters: 5, pricePerLiter: 65, amountOwed: 325, saleDate: new Date(new Date().setDate(new Date().getDate() - 2)), expectedPaymentDate: new Date(new Date().setDate(new Date().getDate() + 5)), status: 'outstanding' },
    { id: 'credit3', customerName: 'Peter Jones', liters: 8, pricePerLiter: 60, amountOwed: 480, saleDate: new Date(new Date().setDate(new Date().getDate() - 5)), expectedPaymentDate: new Date(new Date().setDate(new Date().getDate() + 2)), status: 'paid' },
];

// Mock profit data for the chart (last 7 days)
const mockProfitData: ProfitData[] = Array.from({ length: 7 }, (_, i) => {
  const date = new Date();
  date.setDate(date.getDate() - (6 - i));
  return {
    date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    profit: Math.floor(Math.random() * (1500 - 500 + 1) + 500),
  };
});


export async function getDashboardData() {
  // In a real app, you'd fetch this from a database
  const totalRevenue = mockTransactions.filter(t => t.type === 'sale').reduce((sum, t) => sum + t.value, 0);
  const totalCost = mockTransactions.filter(t => t.type === 'delivery').reduce((sum, t) => sum + t.value, 0);
  const totalProfit = totalRevenue + totalCost; // cost is negative
  const totalCredit = mockCreditSales.filter(c => c.status === 'outstanding').reduce((sum, c) => sum + c.amountOwed, 0);

  const stats: Stat[] = [
    { key: 'profit', label: 'Total Profit', value: `KES ${totalProfit.toLocaleString()}`, change: '+20.1%', changeType: 'increase', icon: 'TrendingUp' },
    { key: 'revenue', label: 'Total Revenue', value: `KES ${totalRevenue.toLocaleString()}`, change: '+15.2%', changeType: 'increase', icon: 'Banknote' },
    { key: 'credit', label: 'Outstanding Credit', value: `KES ${totalCredit.toLocaleString()}`, change: '-5.0%', changeType: 'decrease', icon: 'Users' },
    { key: 'milk_owed', label: 'Owed to Milkman', value: `KES ${(-totalCost).toLocaleString()}`, change: '+10%', changeType: 'increase', icon: 'Droplet' },
  ];

  return {
    stats,
    profitData: mockProfitData,
    recentActivity: mockTransactions.sort((a,b) => b.date.getTime() - a.date.getTime()),
    creditData: mockCreditSales,
  };
}
