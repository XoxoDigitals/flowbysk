import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  typescript: {
    // Pre-existing route typing noise; do not block production deploys.
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  async redirects() {
    return [
      { source: '/studio', destination: '/dashboard/studio', permanent: false },
      { source: '/studio/index.html', destination: '/dashboard/studio', permanent: false },
      { source: '/index.html', destination: '/dashboard/studio', permanent: false },
      { source: '/static/index.html', destination: '/dashboard/studio', permanent: false },
    ];
  },
  async rewrites() {
    return [
      // /studio → handled by redirects() to /dashboard/studio

      {
        source: '/api/auth/session-diagnostics',
        destination: 'http://127.0.0.1:8000/api/auth/session-diagnostics',
      },
      // /api/auth/cookies — removed; BiB handles cookie management natively
      {
        source: '/api/auth/tier',
        destination: 'http://127.0.0.1:8000/api/auth/tier',
      },
      {
        source: '/api/auth/refresh',
        destination: 'http://127.0.0.1:8000/api/auth/refresh',
      },
      // /api/auth/sync-chrome-cookies — removed; BiB handles session natively
      {
        source: '/api/auth/sync-local',
        destination: 'http://127.0.0.1:8000/api/auth/sync-local',
      },
      {
        source: '/api/auth/simulation',
        destination: 'http://127.0.0.1:8000/api/auth/simulation',
      },
      {
        source: '/api/auth/browser-login',
        destination: 'http://127.0.0.1:8000/api/auth/browser-login',
      },
      {
        source: '/api/auth/disconnect',
        destination: 'http://127.0.0.1:8000/api/auth/disconnect',
      },
      // /api/video/download/[id] — Next (cloud URL redirect; no Python local file)
      // /api/video/upscale/[id] — Next (BiB p0UkFb cloud upsample)
      // /api/video/extend — Next (BiB I2V)
      // /api/prompt/enhance — Next
      // /api/whisk/compose — Next (BiB)
      // /api/characters/voices|sync — Next
      {
        source: '/api/video/last-frame/:path*',
        destination: 'http://127.0.0.1:8000/api/video/last-frame/:path*',
      },
      {
        source: '/api/models',
        destination: 'http://127.0.0.1:8000/api/models',
      },
      {
        source: '/api/whisk/caption',
        destination: 'http://127.0.0.1:8000/api/whisk/caption',
      },
      {
        source: '/api/whisk/variants',
        destination: 'http://127.0.0.1:8000/api/whisk/variants',
      },
      {
        source: '/api/logs',
        destination: 'http://127.0.0.1:8000/api/logs',
      },
    ];
  },
};

export default nextConfig;
