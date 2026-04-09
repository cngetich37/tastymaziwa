import { Logo } from '@/components/logo';
import { Nav } from '@/components/nav';
import { ThemeToggle } from './theme-toggle';
import { auth, signOut } from '@/auth';

export async function Header() {
  const session = await auth();
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-white/10 px-4 glass md:px-6">
      <div className="flex items-center gap-2">
        <Logo />
        <h1 className="text-xl font-bold tracking-tight gradient-text font-headline">
          TastyMaziwa
        </h1>
      </div>
      {session && <Nav />}
      <div className="ml-auto flex items-center gap-4">
        {session && (
          <form action={async () => {
             'use server';
             await signOut({ redirectTo: '/login' });
          }}>
            <button className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Sign Out</button>
          </form>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}
