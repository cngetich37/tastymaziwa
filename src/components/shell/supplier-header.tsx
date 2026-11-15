'use client';

import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { LogOut } from 'lucide-react';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Avatar } from './app-sidebar';

/** The supplier portal's only chrome: whose shop, your account, sign out. */
export function SupplierHeader({ name, shopName }: { name: string; shopName: string }) {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur print:hidden">
      <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-4">
        <Link href="/supply" className="flex min-w-0 items-center gap-2">
          <Logo />
          <span className="min-w-0">
            <span className="block truncate font-bold leading-tight tracking-tight">{shopName}</span>
            <span className="block text-xs text-muted-foreground">Supplier</span>
          </span>
        </Link>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle className="size-11" />
          <Link href="/supply/account" aria-label="Your account" className="flex size-11 items-center justify-center">
            <Avatar name={name} className="size-8 text-xs" />
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label="Sign out"
            onClick={() => signOut({ redirectTo: '/login' })}
          >
            <LogOut className="size-5" aria-hidden />
          </Button>
        </div>
      </div>
    </header>
  );
}
