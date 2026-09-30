import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { PageHeader, EmptyState } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Dashboard" };

const PIPELINE = [
  { label: "Draft", count: 0 },
  { label: "Sent", count: 0 },
  { label: "Partially signed", count: 0 },
  { label: "Completed", count: 0 },
] as const;

export default async function DashboardPage() {
  // Redundant with the group layout, and deliberately so: every page that
  // reads data states its own requirement rather than inheriting one.
  const owner = await requireOwner();
  const firstName = owner.fullName?.split(" ")[0];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={firstName ? `Welcome back, ${firstName}` : "Dashboard"}
        description="Contracts you are managing, and anything waiting on a signature."
      />

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PIPELINE.map(({ label, count }) => (
          <Card key={label}>
            <CardContent className="p-5 pt-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {label}
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{count}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <EmptyState
        title="No contracts yet"
        description="Upload a PDF to get started. Charter keeps the original untouched and records every change as a new version."
        hint="Upload arrives in Phase 2."
      />
    </div>
  );
}
