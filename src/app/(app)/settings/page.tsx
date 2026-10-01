import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { listSignatures } from "@/lib/signatures/actions";
import { PageHeader } from "@/components/shell/page-header";
import { SignatureCreator } from "@/components/signatures/signature-creator";
import { SignatureList } from "@/components/signatures/signature-list";
import { DisplayNameForm } from "@/components/settings/display-name-form";
import { AccessPanel } from "@/components/settings/access-panel";
import { getAccessReport } from "@/lib/access/report";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const owner = await requireOwner();
  const [signatures, access] = await Promise.all([listSignatures(), getAccessReport()]);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Settings" description="Your account and signing identity." />

      <div className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>Signatures &amp; initials</CardTitle>
            <CardDescription>
              Saved here once and reusable on any document. Draw one, type your name in a
              handwriting face, or upload a PNG.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* The font class is passed down because next/font can only be
                called from a server component, and the canvas needs the family
                it generates. */}
            <SignatureCreator fontClass="font-caveat" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Saved</CardTitle>
            <CardDescription>
              The default for each kind is offered first in the editor.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <SignatureList signatures={signatures} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Access</CardTitle>
            <CardDescription>
              Everyone who can reach this workspace, and whether the three places that
              control it agree.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AccessPanel report={access} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>
              Your name appears in the From line of signing requests and on the certificate
              of completion. Access itself is granted by address — to add or remove someone,
              update the owner_allowlist table and the OWNER_ALLOWLIST variable together.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <DisplayNameForm fullName={owner.fullName} />
            <div className="flex justify-between gap-4 border-t border-border pt-4 text-sm">
              <span className="text-muted-foreground">Email</span>
              <span className="truncate font-medium">{owner.email}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
