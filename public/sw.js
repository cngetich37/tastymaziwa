/*
 * TastyMaziwa service worker.
 *
 * Makes the installed app start fast on patchy data and show a friendly
 * screen when there is no connection. It deliberately never stores pages or
 * shop data (sales, customers, money): a shared or lost phone must not leak
 * the books, and figures must never be stale. Only the app's own versioned
 * code, fonts and icons are cached.
 */
// The app registers /sw.js?v=<build>, so each deploy installs a fresh worker
// and the previous build's cached files are cleared on activate.
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const STATIC_CACHE = `tm-static-${VERSION}`;
const OFFLINE_URL = '/offline';
const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png', '/icons/icon-512.png'];

/** The offline page plus the CSS, fonts and scripts it loads, so it looks right with no connection. */
async function precache() {
  const cache = await caches.open(STATIC_CACHE);
  await cache.addAll(PRECACHE);
  const html = await (await cache.match(OFFLINE_URL)).text();
  const assets = [...new Set([...html.matchAll(/(?:href|src)="(\/_next\/static\/[^"]+)"/g)].map((m) => m[1]))];
  await cache.addAll(assets);
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tm-') && k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Content-hashed build files and icons: safe to serve from cache forever. */
const isStaticAsset = (url) =>
  url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || url.pathname === '/favicon.ico';

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // server actions, sign-in, callbacks: always the network
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Page loads: always the network (fresh figures, no shop data on the phone);
  // with no connection, the offline screen instead of the browser's error page.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
  // Everything else (page data, images of data): straight to the network.
});
