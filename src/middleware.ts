import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Two jobs only: keep the Supabase session cookie fresh, and send anonymous
 * traffic to the login page instead of rendering an app route.
 *
 * This is a convenience layer, not the security boundary — requireOwner() in
 * src/lib/auth.ts and RLS in the database are. Anything that reads or writes
 * data checks there too.
 */

/** Reachable without a session. Everything else requires one. */
const PUBLIC_PREFIXES = [
  "/login",
  "/auth",
  "/sign",
  // The signer's own document fetch. Authorized by its hashed token, not by a
  // session — see resolveSignerToken.
  "/api/sign",
  "/legal",
] as const;

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  if (isPublic(pathname)) {
    // Signed-in owners have no reason to sit on the login page.
    if (user && (pathname === "/login" || pathname === "/")) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return response;
  }

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /**
     * Everything except Next internals, static assets, and /api.
     *
     * API routes are excluded deliberately. Middleware's only jobs are
     * refreshing the session cookie and redirecting anonymous page requests;
     * neither applies to a fetch, and every route under /api authorises itself
     * — through requireOwner, through RLS on the querying session, or by
     * resolving a signer token. Leaving them in meant a thumbnail request paid
     * for a full token revalidation against Supabase before it even reached the
     * handler, which on a dashboard of cards is most of the page's latency.
     */
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf)$).*)",
  ],
};
