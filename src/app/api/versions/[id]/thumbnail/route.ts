import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { STORAGE_BUCKET } from "@/lib/contracts/types";

/**
 * A version's page-1 preview.
 *
 * The hottest authenticated route in the app — one request per card on the
 * dashboard — so it is deliberately lean:
 *
 *   * No requireOwner(). The session client carries the user's JWT from the
 *     cookie, and contract_versions' RLS policy is gated on is_owner(), so a
 *     caller who is not an owner simply gets no row and a 404. RLS is the
 *     authorization, and calling requireOwner() as well would add a token
 *     revalidation round trip to every image.
 *   * Cached immutably. A version's bytes never change — a new version means a
 *     new row and a new URL — so the browser need never ask twice.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: version } = await supabase
    .from("contract_versions")
    .select("thumbnail_path, state")
    .eq("id", id)
    .maybeSingle();

  if (!version?.thumbnail_path || version.state !== "ready") {
    return new NextResponse("Not found", { status: 404 });
  }

  // Version ids are stable and their content is immutable, so the id is a sound
  // ETag and lets a revalidating browser skip the download entirely.
  const etag = `"thumb-${id}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }

  const { data, error } = await createAdminClient()
    .storage.from(STORAGE_BUCKET)
    .download(version.thumbnail_path);

  if (error || !data) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(await data.arrayBuffer(), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      ETag: etag,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
