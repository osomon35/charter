import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getContract } from "@/lib/contracts/queries";
import { overlaySchema } from "@/lib/editor/schema";
import type { OverlayElement } from "@/lib/editor/types";
import { Editor } from "@/components/editor/editor";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Editor",
  robots: { index: false, follow: false },
};

/**
 * Deliberately outside the (app) route group, so it gets the root layout and
 * none of the sidebar — the editor wants the whole viewport.
 */
export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOwner();
  const { id } = await params;

  const contract = await getContract(id);
  if (!contract) notFound();

  if (!contract.latest) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold tracking-tight">Nothing to edit</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This contract has no readable file attached yet.
          </p>
          <Link
            href={`/contracts/${id}`}
            className={`${buttonVariants({ variant: "outline" })} mt-6`}
          >
            Back to contract
          </Link>
        </div>
      </main>
    );
  }

  const supabase = await createClient();
  const { data: overlay } = await supabase
    .from("contract_overlays")
    .select("elements, base_version_id")
    .eq("contract_id", id)
    .maybeSingle();

  // A draft saved against an older version would place elements against a page
  // that has since changed, so it is dropped rather than misapplied.
  const sameBase = !overlay?.base_version_id || overlay.base_version_id === contract.latest.id;
  const parsed = overlaySchema.safeParse(overlay?.elements ?? []);
  const initialElements: OverlayElement[] = sameBase && parsed.success ? parsed.data : [];

  return (
    <Editor
      contractId={contract.id}
      contractTitle={contract.title}
      versionId={contract.latest.id}
      pageCount={contract.latest.page_count ?? 1}
      initialElements={initialElements}
    />
  );
}
