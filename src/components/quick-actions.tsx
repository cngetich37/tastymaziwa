'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useData } from '@/context/data-context';
import { PackagePlus, Truck, ShoppingCart, DollarSign, Loader2 } from 'lucide-react';

export function QuickActions() {
  const { customers, fetchData } = useData() as any;
  
  // Modals state
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [saleOpen, setSaleOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  
  // Loading state
  const [loading, setLoading] = useState(false);

  // Intake Form State
  const [liters, setLiters] = useState('');
  const [cost, setCost] = useState('50');

  // Sale Form State
  const [saleLiters, setSaleLiters] = useState('');
  const [salePrice, setSalePrice] = useState('70');
  const [isCredit, setIsCredit] = useState(false);
  const [customerId, setCustomerId] = useState('');

  // Payment Form State
  const [payAmount, setPayAmount] = useState('');
  const [payCustomerId, setPayCustomerId] = useState('');

  // Reload helper
  const refresh = async () => {
    if (fetchData) await fetchData();
  };

  const handleIntake = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await fetch('/api/actions/intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liters, costPerLiter: cost })
    });
    await refresh();
    setLoading(false);
    setIntakeOpen(false);
  };

  const handleSale = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await fetch('/api/actions/sale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liters: saleLiters, pricePerLiter: salePrice, isCredit, customerId })
    });
    await refresh();
    setLoading(false);
    setSaleOpen(false);
  };

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await fetch('/api/actions/payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId: payCustomerId, amount: payAmount })
    });
    await refresh();
    setLoading(false);
    setPaymentOpen(false);
  };

  const handleProcessSubs = async () => {
    if (!confirm('Are you sure you want to process all active daily subscriptions?')) return;
    setLoading(true);
    await fetch('/api/actions/process-subscriptions', { method: 'POST' });
    await refresh();
    setLoading(false);
    alert('Subscriptions processed successfully!');
  };

  return (
    <div className="flex flex-wrap gap-4 mb-8 pt-2">
      <Dialog open={intakeOpen} onOpenChange={setIntakeOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" className="glass-card hover:bg-primary/20 border-primary/30 transition-all gap-2 text-primary font-medium tracking-wide">
            <PackagePlus className="w-4 h-4" /> Log Intake
          </Button>
        </DialogTrigger>
        <DialogContent className="glass">
          <DialogHeader><DialogTitle>Log Morning Intake</DialogTitle></DialogHeader>
          <form onSubmit={handleIntake} className="grid gap-4 mt-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Liters Received</label>
              <input type="number" required value={liters} onChange={e => setLiters(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Cost per Liter (KES)</label>
              <input type="number" required value={cost} onChange={e => setCost(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
            </div>
            <Button type="submit" disabled={loading} className="w-full mt-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Intake'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Button variant="outline" onClick={handleProcessSubs} disabled={loading} className="glass-card hover:bg-purple-500/20 border-purple-500/30 transition-all gap-2 text-purple-600 dark:text-purple-400 font-medium tracking-wide">
        <Truck className="w-4 h-4" /> Process Deliveries
      </Button>

      <Dialog open={saleOpen} onOpenChange={setSaleOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" className="glass-card hover:bg-emerald-500/20 border-emerald-500/30 transition-all gap-2 text-emerald-600 dark:text-emerald-400 font-medium tracking-wide">
            <ShoppingCart className="w-4 h-4" /> New Sale
          </Button>
        </DialogTrigger>
        <DialogContent className="glass">
          <DialogHeader><DialogTitle>Record Retail Sale</DialogTitle></DialogHeader>
          <form onSubmit={handleSale} className="grid gap-4 mt-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Liters Sold</label>
              <input type="number" required value={saleLiters} onChange={e => setSaleLiters(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Price per Liter (KES)</label>
              <input type="number" required value={salePrice} onChange={e => setSalePrice(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
            </div>
            <div className="flex items-center gap-2 mt-2 border p-3 rounded-md bg-muted/30">
              <input type="checkbox" id="credit" checked={isCredit} onChange={e => setIsCredit(e.target.checked)} className="w-4 h-4" />
              <label htmlFor="credit" className="text-sm font-medium">Is this a Credit Sale?</label>
            </div>
            {isCredit && (
              <div className="grid gap-2 animate-in slide-in-from-top-2">
                <label className="text-sm font-medium">Select Customer</label>
                <select required={isCredit} value={customerId} onChange={e => setCustomerId(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <option value="">-- Choose Customer --</option>
                  {(customers || []).map((c: any) => (
                    <option key={c.id} value={c.id}>{c.name} (Bal: {c.balance})</option>
                  ))}
                </select>
              </div>
            )}
            <Button type="submit" disabled={loading} className="w-full mt-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Record Sale'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" className="glass-card hover:bg-amber-500/20 border-amber-500/30 transition-all gap-2 text-amber-600 dark:text-amber-400 font-medium tracking-wide">
            <DollarSign className="w-4 h-4" /> Receive Payment
          </Button>
        </DialogTrigger>
        <DialogContent className="glass">
          <DialogHeader><DialogTitle>Receive Customer Payment</DialogTitle></DialogHeader>
          <form onSubmit={handlePayment} className="grid gap-4 mt-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Customer</label>
              <select required value={payCustomerId} onChange={e => setPayCustomerId(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="">-- Choose Customer --</option>
                {(customers || []).map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name} (Bal: {c.balance})</option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Amount Paid (KES)</label>
              <input type="number" required value={payAmount} onChange={e => setPayAmount(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
            </div>
            <Button type="submit" disabled={loading} className="w-full mt-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Log Payment'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
