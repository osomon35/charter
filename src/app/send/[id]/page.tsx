import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { getContract } from "@/lib/contracts/queries";
import { SendFlow } from "@/components/send/send-flow";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Send for signature",
  robots: { index: false, follow: false },
};

/** Outside the (app) group: field placement wants the full viewport. */
export default async function SendPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOwner();
  const { id } = await params;

  const contract = await getContract(id);
  if (!contract) notFound();

  if (!contract.latest) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold tracking-tight">Nothing to send</h1>
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

  return (
    <SendFlow
      contractId={contract.id}
      contractTitle={contract.title}
      versionId={contract.latest.id}
      pageCount={contract.latest.page_count ?? 1}
    />
  );
}
