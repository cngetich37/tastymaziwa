import { Logo } from '@/components/logo';

export function Header() {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-background/80 px-4 backdrop-blur-sm md:px-6">
      <div className="flex items-center gap-2">
        <Logo />
        <h1 className="text-xl font-bold tracking-tight text-primary font-headline">
          TastyMaziwa Profit Tracker
        </h1>
      </div>
    </header>
  );
}
