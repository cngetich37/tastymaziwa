import { LogOut } from 'lucide-react';
import { signOut } from '@/auth';
import { Logo } from '@/components/logo';
import { DesktopNav } from '@/components/nav';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import type { SessionUser } from '@/server/session';

export function Header({ user }: { user: SessionUser }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur md:h-16 md:px-6">
      <div className="flex items-center gap-2">
        <Logo />
        <span className="text-lg font-bold tracking-tight">TastyMaziwa</span>
      </div>
      <DesktopNav role={user.role} />
      <div className="ml-auto flex items-center gap-2">
        <span className="hidden text-sm text-muted-foreground sm:inline">
          {user.name} · {user.role}
        </span>
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
