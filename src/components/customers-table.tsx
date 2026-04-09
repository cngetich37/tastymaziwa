'use client';

import { useData } from '@/context/data-context';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export function CustomersTable() {
  const { customers, subscriptions } = useData();

  return (
    <Card className="glass-card overflow-hidden animate-in fade-in slide-in-from-bottom-8 duration-700 delay-300 fill-mode-both">
      <CardHeader className="bg-muted/30 border-b border-border/50">
        <CardTitle className="font-headline gradient-text inline-block w-fit">Customers & Subscriptions</CardTitle>
        <CardDescription>Manage your customer base and active milk subscriptions.</CardDescription>
      </CardHeader>
      <CardContent className="max-h-[400px] overflow-y-auto pt-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Active Subscription</TableHead>
              <TableHead className="text-right">Balance (KES)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.length === 0 && (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No customers found.</TableCell></TableRow>
            )}
            {customers.map((customer) => {
              const activeSub = subscriptions.find(s => s.customerId === customer.id && s.status === 'active');
              return (
                <TableRow key={customer.id}>
                  <TableCell>
                    <div className="font-medium">{customer.name}</div>
                    <div className="text-xs text-muted-foreground">{customer.address}</div>
                  </TableCell>
                  <TableCell>{customer.phone}</TableCell>
                  <TableCell>
                    {activeSub ? (
                      <Badge variant="default" className="bg-primary/20 text-primary hover:bg-primary/30 border-none">
                        {activeSub.dailyLiters} L / day
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-muted-foreground">None</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium font-mono">
                    {customer.balance.toLocaleString()}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
