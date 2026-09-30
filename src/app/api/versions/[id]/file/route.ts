import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { STORAGE_BUCKET } from "@/lib/contracts/types";

/**
 * Redirects to a short-lived signed URL for a version's PDF.
 *
 * The bucket is private and has no public read path. Authorization happens
 * here — requireOwner() plus an RLS-backed read of the version row, so a
 * version the caller cannot see produces a 404 rather than a signed URL.
 * Redirecting rather than proxying keeps the bytes off the app server.
 */
const SIGNED_URL_TTL_SECONDS = 60;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireOwner();
  const { id } = await params;

  const supabase = await createClient();
  const { data: version } = await supabase
    .from("contract_versions")
    .select("storage_path, state")
    .eq("id", id)
    .maybeSingle();

  if (!version || version.state !== "ready") {
    return new NextResponse("Not found", { status: 404 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(version.storage_path, SIGNED_URL_TTL_SECONDS);

  if (error || !data) {
    return new NextResponse("Not found", { status: 404 });
  }

  return NextResponse.redirect(data.signedUrl, {
    status: 307,
    headers: { "Cache-Control": "no-store" },
  });
}
