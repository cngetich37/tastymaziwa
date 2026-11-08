import { Header } from '@/components/header';
import { MobileNav } from '@/components/nav';
import { requireUser } from '@/server/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex min-h-dvh flex-col">
      <Header user={user} />
      {/* Bottom padding clears the mobile tab bar. */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-24 md:px-6 md:pt-6 md:pb-10">
        {children}
      </main>
      <MobileNav role={user.role} />
    </div>
  );
}
