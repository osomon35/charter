import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Owner = {
  id: string;
  email: string;
  fullName: string | null;
};

/**
 * The authorization boundary for every protected page and every mutation.
 *
 * Middleware is NOT that boundary. Next.js middleware has had header-spoofing
 * bypasses (CVE-2025-29927), and it cannot see which row a request is about,
 * so it is used here only to refresh the session cookie and bounce obvious
 * anonymous traffic. Real checks happen here and in RLS.
 *
 * Three things must hold: a revalidated Supabase user, an allowlisted address
 * in the app layer, and a profile row that RLS agreed to return — which it
 * only does when public.is_owner() passes in the database.
 */
export async function requireOwner(): Promise<Owner> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user?.email) {
    redirect("/login");
  }

  // Ask the database, under the user's own JWT, whether it considers them an
  // owner. This is the same predicate every RLS policy uses, so an address
  // removed from the allowlist loses access immediately, session or not.
  const { data: isOwner, error: ownerError } = await supabase.rpc("is_owner");

  if (ownerError || isOwner !== true) {
    await supabase.auth.signOut();
    redirect("/login?error=not_permitted");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .eq("id", user.id)
    .maybeSingle();

  return {
    id: user.id,
    email: profile?.email ?? user.email,
    fullName: profile?.full_name ?? null,
  };
}

/** Returns the owner, or null instead of redirecting. For optional gating. */
export async function currentOwner(): Promise<Owner | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const { data: isOwner } = await supabase.rpc("is_owner");
  if (isOwner !== true) return null;

  return { id: user.id, email: user.email, fullName: null };
}
