import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const owner = await requireOwner();

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Settings" description="Your account and signing identity." />

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>
            Access is granted by address. To add or remove someone, update the
            owner_allowlist table and the OWNER_ALLOWLIST variable together.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between gap-4 border-t border-border pt-3 text-sm">
            <span className="text-muted-foreground">Email</span>
            <span className="truncate font-medium">{owner.email}</span>
          </div>
          <div className="flex justify-between gap-4 border-t border-border pt-3 text-sm">
            <span className="text-muted-foreground">Name</span>
            <span className="truncate font-medium">{owner.fullName ?? "—"}</span>
          </div>
        </CardContent>
      </Card>

      <p className="mt-8 text-xs leading-relaxed text-muted-foreground">
        Saved signatures and initials arrive in Phase 4.
      </p>
    </div>
  );
}
