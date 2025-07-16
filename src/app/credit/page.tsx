import { CreditTable } from "@/components/credit-table";
import { Header } from "@/components/header";
import { getDashboardData } from "@/lib/data";

export default async function CreditPage() {
    const { creditData } = await getDashboardData();
    
    return (
        <div className="flex min-h-screen w-full flex-col">
            <Header />
            <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-6 lg:p-8">
               <CreditTable creditSales={creditData} />
            </main>
        </div>
    )
}
