import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import type { CreditSale } from "@/lib/types";
import { MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "./ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { differenceInDays, format } from "date-fns";
import { useData } from "@/context/data-context";

export function CreditTable() {
  const { creditData } = useData();
  const outstandingSales = creditData.filter(s => s.status === 'outstanding');

  const getDueDateColor = (dueDate: Date) => {
    const today = new Date();
    today.setHours(0,0,0,0);
    const daysDiff = differenceInDays(dueDate, today);
    if (daysDiff < 0) return "text-destructive";
    if (daysDiff <= 3) return "text-amber-600 dark:text-amber-500";
    return "text-muted-foreground";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline">Outstanding Credit</CardTitle>
        <CardDescription>Sales made on credit that are yet to be paid as of {format(new Date(), 'PPP')}.</CardDescription>
      </CardHeader>
      <CardContent className="max-h-[400px] overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead className="hidden sm:table-cell">Due Date</TableHead>
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {outstandingSales.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No outstanding credit.</TableCell></TableRow>}
            {outstandingSales.map((sale) => (
              <TableRow key={sale.id}>
                <TableCell>
                  <div className="font-medium">{sale.customerName}</div>
                  <div className={cn("text-sm sm:hidden", getDueDateColor(sale.expectedPaymentDate))}>Due {format(sale.expectedPaymentDate, "MMM d")}</div>
                </TableCell>
                <TableCell className="font-mono">KES {sale.amountOwed.toLocaleString()}</TableCell>
                <TableCell className={cn("hidden sm:table-cell", getDueDateColor(sale.expectedPaymentDate))}>
                  {format(sale.expectedPaymentDate, "MMM d, yyyy")}
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button aria-haspopup="true" size="icon" variant="ghost">
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Toggle menu</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem>Mark as Paid</DropdownMenuItem>
                      <DropdownMenuItem>Send Reminder</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
