import type { MetadataRoute } from 'next';

/**
 * Web app manifest: what makes TastyMaziwa installable on a phone's home
 * screen, opening full-screen like an app. Served at /manifest.webmanifest.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'TastyMaziwa',
    short_name: 'TastyMaziwa',
    description: 'Daily milk sales, deliveries, credit and profit for your maziwa shop.',
    lang: 'en-KE',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f6f7f9',
    theme_color: '#0b7a58',
    categories: ['business', 'finance', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // Long-press the home-screen icon to jump straight to the counter pages.
    shortcuts: [
      { name: 'Sales', url: '/sales', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Deliveries', url: '/deliveries', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Close shift', url: '/close', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
