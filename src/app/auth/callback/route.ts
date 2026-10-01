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
  const failed = NextResponse.redirect(new URL("/login?error=link_invalid", origin));

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  const supabase = await createClient();

  let email: string | undefined;

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return failed;
    email = data.user?.email ?? undefined;
  } else if (tokenHash && type && OTP_TYPES.has(type as EmailOtpType)) {
    const { data, error } = await supabase.auth.verifyOtp({
      type: type as EmailOtpType,
      token_hash: tokenHash,
    });
    if (error) return failed;
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
