import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
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
      {
        source: '/api/auth/cookies',
        destination: 'http://127.0.0.1:8000/api/auth/cookies',
      },
      {
        source: '/api/auth/tier',
        destination: 'http://127.0.0.1:8000/api/auth/tier',
      },
      {
        source: '/api/auth/refresh',
        destination: 'http://127.0.0.1:8000/api/auth/refresh',
      },
      {
        source: '/api/auth/sync-chrome-cookies',
        destination: 'http://127.0.0.1:8000/api/auth/sync-chrome-cookies',
      },
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
      {
        source: '/api/video/download/:path*',
        destination: 'http://127.0.0.1:8000/api/video/download/:path*',
      },
      // /api/video/upscale/[id] — Next (BiB native upsample + Python ffmpeg fallback)
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
