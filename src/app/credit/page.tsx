import { CreditTable } from "@/components/credit-table";
import { Header } from "@/components/header";
import { DataProvider } from "@/context/data-context";

export default async function CreditPage() {
    return (
        <div className="flex min-h-screen w-full flex-col">
            <Header />
            <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-6 lg:p-8">
               <CreditTable />
            </main>
        </div>
    )
}
