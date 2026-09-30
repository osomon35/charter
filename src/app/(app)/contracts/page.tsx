import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { PageHeader, EmptyState } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Contracts" };

export default async function ContractsPage() {
  await requireOwner();

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Contracts"
        description="Every agreement, its versions, and where each one stands."
      />
      <EmptyState
        title="Nothing here yet"
        description="Contracts will appear here once uploading is wired up."
        hint="Phase 2."
      />
    </div>
  );
}
