import type { NextConfig } from "next";

const API =
  process.env.FLOW_API_INTERNAL ||
  process.env.NEXT_PUBLIC_FLOW_API_INTERNAL ||
  "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  typescript: {
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
  async rewrites() {
    // Proxy Express (desktop + dashboard API) so /api and /download work on the same domain.
    return [
      {
        source: "/api/:path*",
        destination: `${API}/api/:path*`,
      },
      {
        source: "/download/:path*",
        destination: `${API}/download/:path*`,
      },
    ];
  },
};

export default nextConfig;
