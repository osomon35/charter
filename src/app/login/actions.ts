"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isAllowlisted } from "@/lib/allowlist";
import { clientIp, consume, worst, type RateLimitResult } from "@/lib/rate-limit";
import { publicEnv } from "@/lib/env";

export type LoginState = {
  error?: string;
  notice?: string;
  email?: string;
};

/**
 * One deliberately vague message for every credential failure — wrong
 * password, no such user, not allowlisted. Anything more specific tells a
 * stranger whether an address is worth attacking.
 */
const GENERIC_FAILURE = "Those details did not match an account.";

const passwordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
  next: z.string().optional(),
});

const magicLinkSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  next: z.string().optional(),
});

/** Only same-origin relative paths may be used as a post-login destination. */
function safeNext(next: string | undefined): string {
  if (!next) return "/dashboard";
  if (!next.startsWith("/") || next.startsWith("//")) return "/dashboard";
  if (next.startsWith("/login") || next.startsWith("/auth")) return "/dashboard";
  return next;
}

const LIMIT_MESSAGES: Record<"limited" | "unavailable", string> = {
  limited: "Too many attempts. Try again in a few minutes.",
  unavailable: "Sign-in is temporarily unavailable. Please try again shortly.",
};

async function checkLimits(email: string): Promise<RateLimitResult> {
  const ip = await clientIp();
  // Two buckets: a wide one per IP, a tighter one per address, so hammering
  // one account is throttled even from a rotating source.
  const [byIp, byEmail] = await Promise.all([
    consume(`login:ip:${ip}`, 20, 600),
    consume(`login:email:${email}`, 8, 600),
  ]);
  return worst(byIp, byEmail);
}

export async function signInWithPassword(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = passwordSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next"),
  });

  if (!parsed.success) {
    return { error: "Enter an email address and password.", email: String(formData.get("email") ?? "") };
  }

  const { email, password, next } = parsed.data;

  const limit = await checkLimits(email);
  if (!limit.ok) {
    return { error: LIMIT_MESSAGES[limit.reason], email };
  }

  // Reject non-allowlisted addresses here, before Supabase is involved at all.
  if (!(await isAllowlisted(email))) {
    return { error: GENERIC_FAILURE, email };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: GENERIC_FAILURE, email };
  }

  redirect(safeNext(next));
}

export async function sendMagicLink(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = magicLinkSchema.safeParse({
    email: formData.get("email"),
    next: formData.get("next"),
  });

  if (!parsed.success) {
    return { error: "Enter a valid email address." };
  }

  const { email, next } = parsed.data;

  const limit = await checkLimits(email);
  if (!limit.ok) {
    return { error: LIMIT_MESSAGES[limit.reason], email };
  }

  // Always report the same thing, whether or not we actually sent anything.
  const sentNotice = "Check your inbox — if that address has access, a sign-in link is on its way.";

  if (!(await isAllowlisted(email))) {
    return { notice: sentNotice, email };
  }

  const supabase = await createClient();
  const callback = new URL("/auth/callback", publicEnv.appUrl);
  callback.searchParams.set("next", safeNext(next));

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: callback.toString(),
      // Never create an account from a magic link. The auth.users trigger
      // would refuse a stranger anyway, but this keeps the flow honest.
      shouldCreateUser: false,
    },
  });

  if (error) {
    console.error("magic_link_error", { message: error.message });
  }

  return { notice: sentNotice, email };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
