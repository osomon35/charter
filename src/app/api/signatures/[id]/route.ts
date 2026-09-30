import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { STORAGE_BUCKET } from "@/lib/contracts/types";

/**
 * Serves a saved signature PNG.
 *
 * Proxied rather than redirected to a signed URL: these are a few tens of
 * kilobytes and appear in pickers that re-render often, so an expiring redirect
 * per render would be worse on every count.
 *
 * Authorization is RLS alone, on purpose. The signatures policy is scoped to
 * `is_owner() and user_id = auth.uid()`, so another owner's signature is a 404
 * here — and calling requireOwner() as well would add a token revalidation to
 * every thumbnail in the picker.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: signature } = await supabase
    .from("signatures")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();

  if (!signature) return new NextResponse("Not found", { status: 404 });

  const { data, error } = await createAdminClient()
    .storage.from(STORAGE_BUCKET)
    .download(signature.storage_path);

  if (error || !data) return new NextResponse("Not found", { status: 404 });

  const etag = `"sig-${id}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }

  return new NextResponse(await data.arrayBuffer(), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      ETag: etag,
      // A signature is never edited in place; deleting it removes the row too.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
