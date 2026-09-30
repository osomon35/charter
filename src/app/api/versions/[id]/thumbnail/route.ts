import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { STORAGE_BUCKET } from "@/lib/contracts/types";

/**
 * Same shape as the file route, but proxies the PNG instead of redirecting:
 * <img> in a list view would otherwise re-follow a redirect to a one-minute
 * URL on every render. Thumbnails are small, and a private Cache-Control lets
 * the browser hold onto them.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireOwner();
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

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(STORAGE_BUCKET)
    .download(version.thumbnail_path);

  if (error || !data) {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(await data.arrayBuffer(), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
