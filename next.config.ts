import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the tracing root: a lockfile in the parent folder otherwise makes Next
  // treat the home directory as the workspace root, which breaks the build.
  outputFileTracingRoot: process.cwd(),
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      // Public, slow-moving pages: a shared cache (Cloudflare) can absorb an
      // announcement burst instead of hitting the database per phone.
      // Pass pages are per-token; let the holder's phone reuse the last render
      // for a few seconds instead of re-hitting the server on every open.
      {
        source: "/pass/:path*",
        headers: [
          { key: "Cache-Control", value: "private, max-age=3, stale-while-revalidate=7" },
        ],
      },
      {
        source: "/results",
        headers: [
          { key: "Cache-Control", value: "public, s-maxage=5, stale-while-revalidate=20" },
        ],
      },
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "public, s-maxage=15, stale-while-revalidate=45" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=()",
          },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
