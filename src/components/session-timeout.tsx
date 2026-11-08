'use client';

import { useEffect, useRef } from 'react';
import { signOut } from 'next-auth/react';
import { toast } from '@/hooks/use-toast';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
/** Refresh the server session at most this often while the user is active. */
const KEEPALIVE_MS = 60_000;
const WARNING_MS = 60_000;

/**
 * Mirrors the server's idle timeout in the browser:
 * - activity (taps, typing) keeps the server session alive, even on screens
 *   that don't make requests, by touching /api/auth/session (which re-issues
 *   the cookie with a fresh expiry);
 * - after `idleSeconds` without activity it signs the session out and sends
 *   the user to the sign-in page, so an unattended phone doesn't keep showing
 *   the shop's books. It must really sign out (clear the cookie): the server's
 *   expiry can trail the browser's by up to KEEPALIVE_MS, and simply opening
 *   /login would let the still-valid cookie bounce the user straight back in.
 */
export function SessionTimeout({ idleSeconds }: { idleSeconds: number }) {
  const lastActivity = useRef(0);
  const lastKeepAlive = useRef(0);
  const warned = useRef(false);
  const signingOut = useRef(false);

  useEffect(() => {
    const idleMs = idleSeconds * 1000;
    // Page load itself just refreshed the server session.
    lastActivity.current = Date.now();
    lastKeepAlive.current = Date.now();

    const onActivity = () => {
      const now = Date.now();
      lastActivity.current = now;
      warned.current = false;
      if (now - lastKeepAlive.current > KEEPALIVE_MS) {
        lastKeepAlive.current = now;
        fetch('/api/auth/session', { cache: 'no-store' }).catch(() => {});
      }
    };

    const tick = () => {
      const idleFor = Date.now() - lastActivity.current;
      if (idleFor >= idleMs) {
        if (signingOut.current) return;
        signingOut.current = true;
        const here = window.location.pathname + window.location.search;
        // signOut() clears the session cookie, then does a full page load to
        // the sign-in page, which also discards the shop data cached in this tab.
        void signOut({ redirectTo: `/login?reason=expired&callbackUrl=${encodeURIComponent(here)}` });
      } else if (idleMs > 2 * WARNING_MS && idleFor >= idleMs - WARNING_MS && !warned.current) {
        warned.current = true;
        toast({ title: 'Still there?', description: "You'll be signed out in a minute. Tap anywhere to stay signed in." });
      }
    };

    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, onActivity, { passive: true });
    // Phones suspend timers in the background: re-check as soon as the tab is visible.
    document.addEventListener('visibilitychange', tick);
    const timer = window.setInterval(tick, Math.min(15_000, idleMs / 4));
    return () => {
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onActivity);
      document.removeEventListener('visibilitychange', tick);
      window.clearInterval(timer);
    };
  }, [idleSeconds]);

  return null;
}
