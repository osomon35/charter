import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isAllowlisted } from "@/lib/allowlist";

/**
 * Magic-link landing.
 *
 * Supabase delivers the link in one of two shapes depending on the project's
 * flow and email template: `?code=` for PKCE, or `?token_hash=&type=` for the
 * OTP verify flow. Both are handled, because which one you get depends on
 * dashboard configuration rather than on anything in this codebase.
 *
 * Either way the allowlist is re-checked afterwards: holding a valid link is
 * not on its own permission to enter.
 */
const OTP_TYPES = new Set<EmailOtpType>(["magiclink", "email", "recovery", "invite", "email_change"]);

function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  if (value.startsWith("/login") || value.startsWith("/auth")) return "/dashboard";
  return value;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get("next"));
  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/login?error=${reason}`, origin));
  const failed = fail("link_invalid");

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  const supabase = await createClient();

  let email: string | undefined;

  if (tokenHash && type && OTP_TYPES.has(type as EmailOtpType)) {
    // Preferred, and the only form invite links take: verifyOtp needs nothing
    // stored in the browser beforehand.
    const { data, error } = await supabase.auth.verifyOtp({
      type: type as EmailOtpType,
      token_hash: tokenHash,
    });
    if (error) {
      console.error("verify_otp_failed", { type, message: error.message });
      return fail(type === "invite" ? "invite_invalid" : "link_invalid");
    }
    email = data.user?.email ?? undefined;
  } else if (code) {
    // A PKCE code only works when this browser started the flow, because the
    // verifier lives in a cookie it set. That is true of a magic link requested
    // from the login page, and never true of an admin-generated invite.
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("exchange_code_failed", { message: error.message });
      return failed;
    }
    email = data.user?.email ?? undefined;
  } else {
    return failed;
  }

  if (!(await isAllowlisted(email))) {
    await supabase.auth.signOut();
    return failed;
  }

  return NextResponse.redirect(new URL(next, origin));
}
