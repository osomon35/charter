import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { STORAGE_BUCKET } from "@/lib/contracts/types";
import { resolveSignerToken } from "@/lib/envelopes/signer";
import { clientIp, consume } from "@/lib/rate-limit";

/**
 * Serves the document to an unauthenticated signer.
 *
 * The token is the only credential, and it is resolved through the same function
 * the signing page uses, so an expired, revoked or wrong token gets a 404 here
 * as well. The redirect target is a one-time signed URL for the envelope's
 * frozen source version — never the contract's latest version, which could have
 * moved on since the link was sent.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const ip = await clientIp();
  const limit = await consume(`sign-file:ip:${ip}`, 120, 600);
  if (!limit.ok) return new NextResponse("Too many requests", { status: 429 });

  const lookup = await resolveSignerToken(token);
  if (!lookup.ok) return new NextResponse("Not found", { status: 404 });

  const admin = createAdminClient();
  const { data: version } = await admin
    .from("contract_versions")
    .select("storage_path, state")
    .eq("id", lookup.context.envelope.sourceVersionId)
    .maybeSingle();

  if (!version || version.state !== "ready") {
    return new NextResponse("Not found", { status: 404 });
  }

  const { data, error } = await admin.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(version.storage_path, 300);

  if (error || !data) return new NextResponse("Not found", { status: 404 });

  return NextResponse.redirect(data.signedUrl, {
    status: 307,
    headers: { "Cache-Control": "no-store" },
  });
}
