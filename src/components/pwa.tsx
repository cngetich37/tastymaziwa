'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Download, RotateCw, Share, SquarePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/** Chrome's install prompt event (not in the DOM typings yet). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// --- install state, shared by every install button ---------------------------------------

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

type InstallState = 'unknown' | 'installed' | 'prompt' | 'ios' | 'unavailable';

function snapshot(): InstallState {
  if (installed || isStandalone()) return 'installed';
  if (deferred) return 'prompt';
  if (isIos()) return 'ios';
  return 'unavailable';
}

/** 'prompt' (Android/Chrome), 'ios' (Add to Home Screen by hand), or nothing to offer. */
function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, snapshot, () => 'unknown');
}

/**
 * Registers the service worker (production only: in development it would
 * cache code you are editing) and listens for the browser's install offer.
 * Mounted once, in the root layout, so even the login page is installable.
 */
export function PwaRegister() {
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // show our own button instead of the mini-infobar
      deferred = e as BeforeInstallPromptEvent;
      notify();
    };
    const onInstalled = () => {
      installed = true;
      deferred = null;
      notify();
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register(`/sw.js?v=${process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev'}`, { scope: '/' })
        .catch((error) => console.warn('[pwa] service worker not registered', error));
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);
  return null;
}

async function promptInstall() {
  if (!deferred) return;
  const event = deferred;
  deferred = null;
  notify();
  await event.prompt();
  if ((await event.userChoice).outcome === 'accepted') {
    installed = true;
    notify();
  }
}

function IosSteps({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader className="text-left">
          <DialogTitle>Add TastyMaziwa to your home screen</DialogTitle>
          <DialogDescription>In Safari, two taps:</DialogDescription>
        </DialogHeader>
        <ol className="grid gap-3 text-sm">
          <li className="flex items-center gap-3">
            <span className="rounded-lg bg-muted p-2">
              <Share className="size-5" aria-hidden />
            </span>
            Tap <strong>Share</strong> at the bottom of the screen.
          </li>
          <li className="flex items-center gap-3">
            <span className="rounded-lg bg-muted p-2">
              <SquarePlus className="size-5" aria-hidden />
            </span>
            Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
          </li>
        </ol>
      </DialogContent>
    </Dialog>
  );
}

/** "Install app": the browser's prompt, or the steps on an iPhone. Hidden once installed. */
export function InstallAppButton({ className, label = 'Install app' }: { className?: string; label?: string }) {
  const state = useInstallState();
  const [iosOpen, setIosOpen] = useState(false);
  if (state !== 'prompt' && state !== 'ios') return null;
  return (
    <>
      <button
        type="button"
        onClick={() => (state === 'prompt' ? promptInstall() : setIosOpen(true))}
        className={cn(
          'flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-primary transition-colors hover:bg-primary/10',
          className,
        )}
      >
        <Download className="size-5 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </button>
      <IosSteps open={iosOpen} onOpenChange={setIosOpen} />
    </>
  );
}

const DISMISS_KEY = 'tm-install-banner-dismissed';
let dismissedThisSession = false;

function bannerDismissed(): boolean {
  if (dismissedThisSession) return true;
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/** A one-time invitation on the main page; "Not now" hides it on this phone. */
export function InstallBanner() {
  const state = useInstallState();
  // Hidden on the server and until the browser says otherwise.
  const dismissed = useSyncExternalStore(subscribe, bannerDismissed, () => true);
  const [iosOpen, setIosOpen] = useState(false);
  if (dismissed || (state !== 'prompt' && state !== 'ios')) return null;
  const dismiss = () => {
    dismissedThisSession = true;
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Private mode: it just shows again next time.
    }
    notify();
  };
  return (
    <section
      aria-label="Install the app"
      className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3 print:hidden"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a 40px static icon; no optimisation needed */}
      <img src="/icons/icon-192.png" alt="" width={40} height={40} className="size-10 rounded-lg" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Install TastyMaziwa</p>
        <p className="text-sm text-muted-foreground">Open it from your home screen, full-screen, like an app.</p>
      </div>
      <div className="flex w-full gap-2 sm:w-auto">
        <Button className="h-11 flex-1 gap-2 sm:flex-none" onClick={() => (state === 'prompt' ? promptInstall() : setIosOpen(true))}>
          <Download className="size-4" aria-hidden /> Install
        </Button>
        <Button variant="ghost" className="h-11 gap-1" onClick={dismiss}>
          <X className="size-4" aria-hidden /> Not now
        </Button>
      </div>
      <IosSteps open={iosOpen} onOpenChange={setIosOpen} />
    </section>
  );
}

export function RetryButton() {
  return (
    <Button className="h-11 gap-2" onClick={() => window.location.reload()}>
      <RotateCw className="size-4" aria-hidden /> Try again
    </Button>
  );
}
