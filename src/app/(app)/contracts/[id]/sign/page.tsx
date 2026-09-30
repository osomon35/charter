import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireOwner } from "@/lib/auth";
import { getContract } from "@/lib/contracts/queries";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = { title: "Sign" };

/**
 * Landing point for the Sign action.
 *
 * The document itself is shown here now, using the browser's own PDF viewer
 * through the authorized signed-URL route — no pdf.js needed for read-only
 * viewing. Field placement and signature capture are Phases 3 and 4, and this
 * page becomes the editor shell rather than being replaced.
 */
export default async function SignPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOwner();
  const { id } = await params;

  const contract = await getContract(id);
  if (!contract) notFound();

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href={`/contracts/${id}`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Back to contract
      </Link>

      <h1 className="text-xl font-semibold tracking-tight">{contract.title}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {contract.latest
          ? `${contract.latest.page_count ?? "?"} pages · version ${contract.latest.version_no}`
          : "No file attached"}
      </p>

      <Alert className="mt-6">
        Read-only for now. Placing fields — signature, initials, date, text, checkbox —
        and signing them is the next phase of work. Nothing on this page modifies the
        document.
      </Alert>

      {contract.latest ? (
        <div className="mt-6 overflow-hidden rounded-lg border border-border bg-surface-muted">
          <iframe
            src={`/api/versions/${contract.latest.id}/file`}
            title={contract.title}
            className="h-[80vh] w-full"
          />
        </div>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">
          There is no file to show. Upload one from the contracts list.
        </p>
      )}
    </div>
  );
}
