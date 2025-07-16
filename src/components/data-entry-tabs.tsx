'use client';

import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from 'lucide-react';
import { Calendar } from './ui/calendar';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import type { Transaction, CreditSale } from '@/lib/types';

interface DataEntryTabsProps {
    onNewTransaction: (tx: Omit<Transaction, 'id'>) => void;
    onNewCreditSale: (sale: Omit<CreditSale, 'id' | 'amountOwed' | 'status'>) => void;
}

export function DataEntryTabs({ onNewTransaction, onNewCreditSale }: DataEntryTabsProps) {
    const { toast } = useToast();
    // Delivery State
    const [deliveryLiters, setDeliveryLiters] = useState('');
    const [deliveryCost, setDeliveryCost] = useState('');

    // Sale State
    const [saleLiters, setSaleLiters] = useState('');
    const [salePrice, setSalePrice] = useState('');
    const [isCredit, setIsCredit] = useState(false);
    const [customerName, setCustomerName] = useState('');
    const [paymentDueDate, setPaymentDueDate] = useState<Date | undefined>(new Date());

    // Payment State
    const [paymentAmount, setPaymentAmount] = useState('');

    const handleDeliverySubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const liters = parseFloat(deliveryLiters);
        const cost = parseFloat(deliveryCost);
        if (isNaN(liters) || isNaN(cost) || liters <= 0 || cost <= 0) {
            toast({ variant: 'destructive', title: "Invalid Input", description: "Please enter valid numbers for liters and cost."});
            return;
        }
        onNewTransaction({
            type: 'delivery',
            date: new Date(),
            description: 'Milk delivery',
            amount: liters,
            value: - (liters * cost),
        });
        toast({ title: "Delivery Recorded", description: `${liters}L at KES ${cost}/L.`});
        setDeliveryLiters('');
        setDeliveryCost('');
    };

    const handleSaleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const liters = parseFloat(saleLiters);
        const price = parseFloat(salePrice);
        if (isNaN(liters) || isNaN(price) || liters <= 0 || price <= 0) {
            toast({ variant: 'destructive', title: "Invalid Input", description: "Please enter valid numbers for liters and price."});
            return;
        }

        if(isCredit) {
            if (!customerName || !paymentDueDate) {
                toast({ variant: 'destructive', title: "Invalid Input", description: "Please enter customer name and payment due date for credit sales."});
                return;
            }
            onNewCreditSale({
                customerName,
                liters,
                pricePerLiter: price,
                saleDate: new Date(),
                expectedPaymentDate: paymentDueDate,
            });
            toast({ title: "Credit Sale Recorded", description: `${liters}L to ${customerName}.`});
        } else {
            onNewTransaction({
                type: 'sale',
                date: new Date(),
                description: 'Cash sale',
                amount: liters,
                value: liters * price,
            });
            toast({ title: "Cash Sale Recorded", description: `${liters}L at KES ${price}/L.`});
        }
        setSaleLiters('');
        setSalePrice('');
        setIsCredit(false);
        setCustomerName('');
        setPaymentDueDate(new Date());
    };

    const handlePaymentSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const amount = parseFloat(paymentAmount);
        if (isNaN(amount) || amount <= 0) {
            toast({ variant: 'destructive', title: "Invalid Input", description: "Please enter a valid payment amount."});
            return;
        }
        onNewTransaction({
            type: 'payment',
            date: new Date(),
            description: 'Payment to milkman',
            amount: amount,
            value: 0, // A payment to milkman affects debt, not directly daily P/L
        });
        toast({ title: "Payment Recorded", description: `Paid KES ${amount} to milkman.`});
        setPaymentAmount('');
    };


    return (
        <Card className="h-full">
            <CardHeader>
                <CardTitle className="font-headline">Record Transactions</CardTitle>
                <CardDescription>
                    Add your daily deliveries, sales, and payments.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Tabs defaultValue="sale">
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="sale">Sale</TabsTrigger>
                        <TabsTrigger value="delivery">Delivery</TabsTrigger>
                        <TabsTrigger value="payment">Payment</TabsTrigger>
                    </TabsList>
                    <TabsContent value="sale">
                        <form onSubmit={handleSaleSubmit} className="space-y-4 pt-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <Label htmlFor="sale-liters">Liters Sold</Label>
                                    <Input id="sale-liters" type="number" step="0.1" placeholder="e.g. 20" value={saleLiters} onChange={(e) => setSaleLiters(e.target.value)} />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="sale-price">Price / Liter (KES)</Label>
                                    <Input id="sale-price" type="number" step="0.01" placeholder="e.g. 65" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} />
                                </div>
                            </div>
                            <div className="flex items-center space-x-2 pt-2">
                                <Checkbox id="credit-sale" checked={isCredit} onCheckedChange={(checked) => setIsCredit(checked as boolean)} />
                                <label htmlFor="credit-sale" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                    Sold on Credit?
                                </label>
                            </div>
                            {isCredit && (
                                <div className="space-y-4 rounded-lg border bg-background p-4 animate-in fade-in-50">
                                    <div className="space-y-1.5">
                                        <Label htmlFor="customer-name">Customer Name</Label>
                                        <Input id="customer-name" placeholder="John Doe" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>Expected Payment Date</Label>
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button
                                                    variant={"outline"}
                                                    className={cn(
                                                        "w-full justify-start text-left font-normal",
                                                        !paymentDueDate && "text-muted-foreground"
                                                    )}
                                                >
                                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                                    {paymentDueDate ? format(paymentDueDate, "PPP") : <span>Pick a date</span>}
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-auto p-0">
                                                <Calendar
                                                    mode="single"
                                                    selected={paymentDueDate}
                                                    onSelect={setPaymentDueDate}
                                                    initialFocus
                                                />
                                            </PopoverContent>
                                        </Popover>
                                    </div>
                                </div>
                            )}
                            <Button type="submit" className="w-full !mt-6">Record Sale</Button>
                        </form>
                    </TabsContent>
                    <TabsContent value="delivery">
                         <form onSubmit={handleDeliverySubmit} className="space-y-4 pt-4">
                            <div className="space-y-1.5">
                                <Label htmlFor="delivery-liters">Liters Delivered</Label>
                                <Input id="delivery-liters" type="number" step="0.1" placeholder="e.g. 50" value={deliveryLiters} onChange={(e) => setDeliveryLiters(e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="delivery-cost">Cost / Liter (KES)</Label>
                                <Input id="delivery-cost" type="number" step="0.01" placeholder="e.g. 35" value={deliveryCost} onChange={(e) => setDeliveryCost(e.target.value)} />
                            </div>
                            <Button type="submit" className="w-full !mt-6">Record Delivery</Button>
                        </form>
                    </TabsContent>
                    <TabsContent value="payment">
                        <form onSubmit={handlePaymentSubmit} className="space-y-4 pt-4">
                             <div className="space-y-1.5">
                                <Label htmlFor="payment-amount">Amount Paid to Milkman (KES)</Label>
                                <Input id="payment-amount" type="number" step="0.01" placeholder="e.g. 1500" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} />
                            </div>
                            <Button type="submit" className="w-full !mt-6">Record Payment</Button>
                        </form>
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    );
}
