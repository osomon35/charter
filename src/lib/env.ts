/**
 * Public configuration. Safe to import from client components — Next inlines
 * NEXT_PUBLIC_* values at build time.
 */
function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing environment variable ${name}. See .env.example for what it should contain.`,
    );
  }
  return value.trim();
}

export const publicEnv = {
  supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: required(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  ),
  appUrl: resolveAppUrl(),
};

/**
 * The origin that signing links are built from.
 *
 * NEXT_PUBLIC_APP_URL wins when set, because a custom domain is something only
 * the operator knows. But a wrong or forgotten value used to produce links
 * pointing at a host that does not serve this app — a 404 in every signing
 * email — so Vercel's own deployment URLs are used as a fallback rather than
 * defaulting to localhost in production.
 *
 * Deliberately not derived from the request's Host header: a header an attacker
 * controls should never end up inside a link that is emailed to someone.
 */
function resolveAppUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return withScheme(configured);

  // Set automatically by Vercel. The production domain is preferred so links
  // from a preview build still point somewhere stable.
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (production) return withScheme(production);

  const deployment = process.env.VERCEL_URL?.trim();
  if (deployment) return withScheme(deployment);

  return "http://localhost:3000";
}

function withScheme(value: string): string {
  const trimmed = value.replace(/\/+$/, "");
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export { required };
