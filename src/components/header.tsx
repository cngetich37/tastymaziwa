import Link from 'next/link';
import { LogOut, UserRound } from 'lucide-react';
import { signOut } from '@/auth';
import { Logo } from '@/components/logo';
import { DesktopNav } from '@/components/nav';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import type { SessionUser } from '@/server/session';

export function Header({ user, shopName }: { user: SessionUser; shopName: string }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur md:h-16 md:px-6">
      <Link href="/" className="flex min-w-0 items-center gap-2">
        <Logo />
        <span className="truncate text-lg font-bold tracking-tight">{shopName}</span>
      </Link>
      <DesktopNav role={user.role} />
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button asChild variant="ghost" size="sm" className="gap-2" title="Your account">
          <Link href="/account" aria-label="Your account">
            <UserRound className="h-4 w-4" />
            <span className="hidden sm:inline">{user.name}</span>
          </Link>
        </Button>
        <ThemeToggle />
        <form
          action={async () => {
            'use server';
            await signOut({ redirectTo: '/login' });
          }}
        >
          <Button variant="ghost" size="icon" aria-label="Sign out" title="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </header>
  );
}
