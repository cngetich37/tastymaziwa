import { Logo } from '@/components/logo';
import { Nav } from '@/components/nav';
import { ThemeToggle } from './theme-toggle';

export function Header() {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-white/10 px-4 glass md:px-6">
      <div className="flex items-center gap-2">
        <Logo />
        <h1 className="text-xl font-bold tracking-tight gradient-text font-headline">
          TastyMaziwa
        </h1>
      </div>
      <Nav />
      <div className="ml-auto">
        <ThemeToggle />
      </div>
    </header>
  );
}
