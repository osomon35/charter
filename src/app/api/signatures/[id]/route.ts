import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { STORAGE_BUCKET } from "@/lib/contracts/types";

/**
 * Serves a saved signature PNG.
 *
 * Proxied rather than redirected to a signed URL: these are a few tens of
 * kilobytes and appear in pickers that re-render often, so an expiring redirect
 * per render would be worse on every count. RLS decides whose rows are
 * readable, so another owner's signature is a 404 here.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireOwner();
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

  return new NextResponse(await data.arrayBuffer(), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
