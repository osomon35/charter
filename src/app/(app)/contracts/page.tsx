import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { listContracts } from "@/lib/contracts/queries";
import { PageHeader, EmptyState } from "@/components/shell/page-header";
import { Uploader } from "@/components/upload/uploader";
import { ContractCard } from "@/components/contracts/contract-card";

export const metadata: Metadata = { title: "Contracts" };

export default async function ContractsPage() {
  await requireOwner();
  const contracts = await listContracts();

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Contracts"
        description="Drop a PDF to add it. The original is stored untouched — edits and signatures create new versions."
      />

      <Uploader />

      <div className="mt-10">
        {contracts.length === 0 ? (
          <EmptyState
            title="No contracts yet"
            description="Once you upload a PDF it will appear here with its page count and a preview of the first page."
          />
        ) : (
          <>
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {contracts.length} contract{contracts.length === 1 ? "" : "s"}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {contracts.map((contract) => (
                <ContractCard key={contract.id} contract={contract} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
