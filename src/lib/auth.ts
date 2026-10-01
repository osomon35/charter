import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

import { redirect as nextRedirect } from "next/navigation";
import type { MemberRole } from "@/lib/members/types";

export type Owner = {
  id: string;
  email: string;
  fullName: string | null;
  role: MemberRole;
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

  // One query answers both questions: the row proves membership, because its RLS
  // policy requires is_owner(), and member_role() comes back in the same trip.
  const [{ data: profile }, { data: role }] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name").eq("id", user.id).maybeSingle(),
    supabase.rpc("member_role"),
  ]);

  if (profile) {
    return {
      id: user.id,
      email: profile.email ?? user.email,
      fullName: profile.full_name ?? null,
      // A blocked member gets null back from member_role(), and the profile read
      // would already have failed — but defaulting to the least-privileged role
      // means an unexpected null never grants anything.
      role: isRole(role) ? role : "signer",
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

  const { data: freshRole } = await supabase.rpc("member_role");

  const { error: insertError } = await supabase
    .from("profiles")
    .insert({ id: user.id, email: user.email.toLowerCase() });

  // Not fatal: a missing profile costs the display name, nothing more.
  if (insertError) {
    console.error("profile_bootstrap_failed", { message: insertError.message });
  }

  return {
    id: user.id,
    email: user.email,
    fullName: null,
    role: isRole(freshRole) ? freshRole : "signer",
  };
});

function isRole(value: unknown): value is MemberRole {
  return value === "admin" || value === "sender" || value === "signer";
}

/**
 * For pages and actions that only an admin may reach.
 *
 * Belt and braces with RLS: owner_allowlist's write policies are gated on
 * is_admin() in the database, so this failing open would still not hand out
 * access. It exists so a non-admin gets a redirect rather than a silent no-op.
 */
export async function requireAdmin(): Promise<Owner> {
  const owner = await requireOwner();
  if (owner.role !== "admin") nextRedirect("/dashboard?error=admin_only");
  return owner;
}

/** For anything that creates or changes a contract. */
export async function requireContractAccess(): Promise<Owner> {
  const owner = await requireOwner();
  if (owner.role === "signer") nextRedirect("/settings?error=signer_only");
  return owner;
}

/** Returns the owner, or null instead of redirecting. For optional gating. */
export const currentOwner = cache(async (): Promise<Owner | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const [{ data: profile }, { data: role }] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name").eq("id", user.id).maybeSingle(),
    supabase.rpc("member_role"),
  ]);

  if (!profile) return null;

  return {
    id: user.id,
    email: profile.email ?? user.email,
    fullName: profile.full_name ?? null,
    role: isRole(role) ? role : "signer",
  };
});
