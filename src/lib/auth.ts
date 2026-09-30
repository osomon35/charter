import "server-only";

import { cache } from "react";
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
 * bypasses (CVE-2025-29927), and it cannot see which row a request is about, so
 * it is used only to refresh the session cookie and bounce obvious anonymous
 * traffic. Real checks happen here and in RLS.
 *
 * Wrapped in React's cache(): the (app) layout and the page it renders both call
 * this, and before deduplication that meant every navigation paid for the whole
 * check twice. cache() is per-request, so it never leaks one user's result to
 * another.
 *
 * Two round trips in the steady state, not four. Reading the profile row is
 * itself the ownership check — its RLS policy is `is_owner() and id =
 * auth.uid()`, so a row coming back proves both. is_owner() is only called
 * explicitly when there is no row yet, which happens once per account.
 */
export const requireOwner = cache(async (): Promise<Owner> => {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user?.email) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (profile) {
    return {
      id: user.id,
      email: profile.email ?? user.email,
      fullName: profile.full_name ?? null,
    };
  }

  // No profile row: either a first sign-in, or an address that has been removed
  // from the allowlist. Ask the database which, since those need opposite
  // outcomes.
  const { data: isOwner, error: ownerError } = await supabase.rpc("is_owner");

  if (ownerError || isOwner !== true) {
    await supabase.auth.signOut();
    redirect("/login?error=not_permitted");
  }

  const { error: insertError } = await supabase
    .from("profiles")
    .insert({ id: user.id, email: user.email.toLowerCase() });

  // Not fatal: a missing profile costs the display name, nothing more.
  if (insertError) {
    console.error("profile_bootstrap_failed", { message: insertError.message });
  }

  return { id: user.id, email: user.email, fullName: null };
});

/** Returns the owner, or null instead of redirecting. For optional gating. */
export const currentOwner = cache(async (): Promise<Owner | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) return null;

  return {
    id: user.id,
    email: profile.email ?? user.email,
    fullName: profile.full_name ?? null,
  };
});
