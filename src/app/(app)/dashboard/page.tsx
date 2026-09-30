import type { Metadata } from "next";
import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { listContracts, statusCounts } from "@/lib/contracts/queries";
import { PageHeader, EmptyState } from "@/components/shell/page-header";
import { ContractCard } from "@/components/contracts/contract-card";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Dashboard" };

const TILES = [
  { status: "draft", label: "Draft" },
  { status: "sent", label: "Sent" },
  { status: "partially_signed", label: "Partially signed" },
  { status: "completed", label: "Completed" },
] as const;

export default async function DashboardPage() {
  const owner = await requireOwner();
  const [counts, contracts] = await Promise.all([statusCounts(), listContracts()]);
  const firstName = owner.fullName?.split(" ")[0];
  const recent = contracts.slice(0, 6);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={firstName ? `Welcome back, ${firstName}` : "Dashboard"}
        description="Contracts you are managing, and anything waiting on a signature."
        action={
          <Link href="/contracts" className={buttonVariants({ size: "sm" })}>
            Upload a PDF
          </Link>
        }
      />

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {TILES.map(({ status, label }) => (
          <Card key={status}>
            <CardContent className="p-5 pt-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {label}
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
                {counts[status] ?? 0}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {recent.length === 0 ? (
        <EmptyState
          title="No contracts yet"
          description="Upload a PDF to get started. Charter keeps the original untouched and records every change as a new version."
        />
      ) : (
        <>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Recent
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {recent.map((contract) => (
              <ContractCard key={contract.id} contract={contract} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
