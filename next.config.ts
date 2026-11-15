import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // PGlite ships a WASM build that must not be bundled.
  serverExternalPackages: ['@electric-sql/pglite'],
  env: {
    // Versions the service worker's cache: each deploy gets a fresh one.
    NEXT_PUBLIC_BUILD_ID: (process.env.VERCEL_GIT_COMMIT_SHA ?? String(Date.now())).slice(0, 12),
  },
  async headers() {
    return [
      {
        // Always check for a new service worker; it may control the whole site.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;
