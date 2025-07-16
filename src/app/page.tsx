import { DashboardClient } from '@/components/dashboard-client';
import { Header } from '@/components/header';
import { getDashboardData } from '@/lib/data';

export default async function Home() {
  const {
    stats,
    profitData,
    recentActivity,
    creditData,
  } = await getDashboardData();

  return (
    <div className="flex min-h-screen w-full flex-col">
      <Header />
      <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-6 lg:p-8">
        <DashboardClient
          initialStats={stats}
          initialProfitData={profitData}
          initialRecentActivity={recentActivity}
          initialCreditData={creditData}
        />
      </main>
    </div>
  );
}
