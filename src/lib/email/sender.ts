import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Who a Charter email appears to come from.
 *
 * Resend will only accept a `from` address on a domain you have verified, so
 * impersonating an arbitrary sender is not possible and should not be — it is
 * what SPF and DKIM exist to prevent. What is possible, and what recipients
 * actually care about, is seeing the owner's name and being able to reply to
 * them:
 *
 *   * Owner's address is on the verified domain -> send as the owner outright.
 *   * Owner's address is elsewhere -> send from the verified address carrying
 *     the owner's name, with Reply-To pointing at them.
 *
 * Either way the mail reads as being from a person rather than from software.
 */
export type Sender = { name: string; email: string };

export type ResolvedFrom = { from: string; replyTo?: string };

/** Splits `Name <addr@example.com>` or a bare address. */
export function parseAddress(raw: string): { name: string | null; address: string } {
  const match = raw.trim().match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  if (match?.[2]) {
    return { name: match[1]?.replace(/^"|"$/g, "").trim() || null, address: match[2].trim() };
  }
  return { name: null, address: raw.trim() };
}

function domainOf(address: string): string {
  return address.split("@")[1]?.toLowerCase() ?? "";
}

/** Quotes a display name so a comma or colon cannot break the header. */
function quoteName(name: string): string {
  return `"${name.replace(/["\\]/g, "").trim()}"`;
}

export function resolveFrom(sender: Sender | null): ResolvedFrom {
  const configured = process.env.EMAIL_FROM?.trim();
  if (!configured) return { from: "" };

  const base = parseAddress(configured);
  if (!sender?.email) return { from: configured };

  const senderName = sender.name.trim() || sender.email;

  if (domainOf(sender.email) === domainOf(base.address)) {
    // Same verified domain: send as the owner for real.
    return { from: `${quoteName(senderName)} <${sender.email}>` };
  }

  return {
    from: `${quoteName(`${senderName} via ${base.name ?? "Charter"}`)} <${base.address}>`,
    replyTo: sender.email,
  };
}

/**
 * The owner's name and address, for use as the sender.
 *
 * Read with the service-role client because completion and sequential
 * notifications run from the signer's request, where there is no authenticated
 * owner to satisfy RLS.
 */
export async function ownerSender(): Promise<Sender | null> {
  const allowlisted = process.env.OWNER_ALLOWLIST?.split(",")[0]?.trim().toLowerCase();
  if (!allowlisted) return null;

  try {
    const { data } = await createAdminClient()
      .from("profiles")
      .select("email, full_name")
      .eq("email", allowlisted)
      .maybeSingle();

    return {
      name: data?.full_name?.trim() || allowlisted,
      email: data?.email ?? allowlisted,
    };
  } catch {
    return { name: allowlisted, email: allowlisted };
  }
}
