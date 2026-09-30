/**
 * Shape of one entry handed to a Supabase `setAll` callback.
 *
 * Why this exists: @supabase/ssr types its `cookies` option as a union of the
 * current and deprecated method sets, and TypeScript will not contextually type
 * a method's parameters through a union. So `setAll(cookiesToSet)` came out as
 * an implicit `any` and failed the build under `strict`. Annotating the
 * parameter explicitly is the fix.
 *
 * Declared structurally rather than imported from @supabase/ssr so it cannot
 * break on a renamed export, and kept compatible with both the library's
 * expected signature and Next's `cookies().set(name, value, options)`.
 */
export type CookieToSet = {
  name: string;
  value: string;
  options?: Partial<{
    domain: string;
    expires: Date;
    httpOnly: boolean;
    maxAge: number;
    path: string;
    priority: "low" | "medium" | "high";
    sameSite: boolean | "lax" | "strict" | "none";
    secure: boolean;
  }>;
};
