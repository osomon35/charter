import type { MetadataRoute } from "next";

/**
 * Disallow everything.
 *
 * The X-Robots-Tag header in next.config.ts already covers every route, but a
 * robots.txt is what a crawler reads first and some only honour that. On a custom
 * domain this matters more than on a vercel.app subdomain nobody links to.
 *
 * Neither is a security control — the signer route is deliberately reachable by
 * anyone holding a token, and nothing else is reachable without a session. This is
 * about not appearing in search results.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
