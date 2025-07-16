import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { Transaction } from "@/lib/types";
import { cn } from "@/lib/utils";

const getBadgeVariant = (type: Transaction['type']): "default" | "secondary" | "destructive" | "outline" => {
    switch(type) {
        case 'sale': return 'default';
        case 'delivery': return 'secondary';
        case 'payment': return 'destructive';
        case 'credit-payment': return 'outline';
        default: return 'secondary';
    }
}

export function RecentActivityTable({ transactions }: { transactions: Transaction[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline">Recent Activity</CardTitle>
        <CardDescription>A log of your recent sales, deliveries, and payments.</CardDescription>
      </CardHeader>
      <CardContent className="max-h-[400px] overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="hidden sm:table-cell">Type</TableHead>
              <TableHead>Details</TableHead>
              <TableHead className="text-right">Value (KES)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">No recent activity.</TableCell></TableRow>}
            {transactions.map((tx) => (
              <TableRow key={tx.id}>
                <TableCell className="hidden sm:table-cell">
                  <Badge variant={getBadgeVariant(tx.type)} className="capitalize">
                    {tx.type.replace('-', ' ')}
                  </Badge>
                </TableCell>
                <TableCell>
                    <div className="font-medium">{tx.description}</div>
                    <div className="text-sm text-muted-foreground">{new Date(tx.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric'})}</div>
                </TableCell>
                <TableCell className={cn(
                  "text-right font-medium font-mono",
                  tx.value > 0 ? "text-green-700 dark:text-green-500" : tx.value < 0 ? "text-destructive" : "text-muted-foreground"
                )}>
                  {tx.value > 0 ? '+' : ''}{tx.value.toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
