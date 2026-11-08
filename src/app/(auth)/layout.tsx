import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-10">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="mb-6 flex items-center gap-2">
        <Logo />
        <span className="text-2xl font-bold tracking-tight">TastyMaziwa</span>
      </div>
      <main className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">{children}</main>
    </div>
  );
}
