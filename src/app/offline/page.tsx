import { WifiOff } from 'lucide-react';
import { Logo } from '@/components/logo';
import { RetryButton } from '@/components/pwa';

export const metadata = { title: 'Offline · TastyMaziwa' };

/**
 * Shown by the service worker when a page can't load. Static and public: it
 * is cached on the phone when the app is installed, and holds no shop data.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="flex items-center gap-2">
        <Logo />
        <span className="text-lg font-bold tracking-tight">TastyMaziwa</span>
      </div>
      <div className="rounded-full bg-muted p-4">
        <WifiOff className="size-8 text-muted-foreground" aria-hidden />
      </div>
      <div className="grid max-w-sm gap-2">
        <h1 className="text-2xl font-bold">You&apos;re offline</h1>
        <p className="text-sm text-muted-foreground">
          TastyMaziwa needs data or Wi-Fi to load your shop. Check your connection, then try again. Nothing you saved
          has been lost.
        </p>
      </div>
      <RetryButton />
    </main>
  );
}
