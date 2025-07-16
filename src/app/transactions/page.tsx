import { Header } from "@/components/header";
import { TransactionsClient } from "@/components/transactions-client";

export default async function TransactionsPage() {
    return (
        <div className="flex min-h-screen w-full flex-col">
            <Header />
            <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-6 lg:p-8">
                <TransactionsClient />
            </main>
        </div>
    )
}
