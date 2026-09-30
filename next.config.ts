import type { NextConfig } from "next";

/**
 * Charter is a private, single-tenant app. Nothing in it should ever be
 * indexed, framed, or sniffed, so the headers below are applied globally
 * rather than per-route.
 */
const securityHeaders = [
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // `next build` runs ESLint by default, which means a lint config problem
  // fails the deploy. CI runs `npm run lint` as its own step, so nothing is
  // lost by taking it off the build's critical path.
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  experimental: {
    // Signature PNGs are posted through a server action so the bytes can be
    // checked before they are stored. Trimmed, they are tens of kilobytes; the
    // default 1 MB limit leaves no margin for an uploaded one.
    serverActions: { bodySizeLimit: "2mb" },
  },
  webpack(config) {
    // pdfjs-dist declares `canvas` as an optional dependency for its Node
    // build. Nothing in the browser entry uses it, but webpack still tries to
    // resolve it and fails the build, so stub it out.
    config.resolve.alias = { ...config.resolve.alias, canvas: false };
    return config;
  },
};

export default nextConfig;
