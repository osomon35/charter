import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { listMembers, listOrphanAccounts } from "@/lib/members/queries";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, MEMBER_ROLES } from "@/lib/members/types";
import { PageHeader } from "@/components/shell/page-header";
import { InviteForm } from "@/components/members/invite-form";
import { MemberList } from "@/components/members/member-list";
import { OrphanAccounts } from "@/components/members/orphan-accounts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage() {
  // Admin only, and the database agrees: owner_allowlist's write policies are
  // gated on is_admin(), so this redirect is convenience rather than the control.
  const admin = await requireAdmin();

  const [members, orphans] = await Promise.all([listMembers(), listOrphanAccounts()]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Members"
        description="Everyone who can reach this workspace, and what each of them may do."
      />

      <div className="space-y-8">
        <OrphanAccounts emails={orphans} />

        <Card>
          <CardHeader>
            <CardTitle>Invite someone</CardTitle>
            <CardDescription>
              They get an email with a link that signs them in. No password to share, and
              nothing to deploy.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InviteForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {members.length} member{members.length === 1 ? "" : "s"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="p-4">
              <MemberList members={members} currentEmail={admin.email} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What the roles mean</CardTitle>
            <CardDescription>
              Enforced in the database, not only in the interface — a role is checked by every
              policy on every query, so it holds even if something in the app gets it wrong.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              {MEMBER_ROLES.map((role) => (
                <div key={role} className="border-t border-border pt-3 first:border-0 first:pt-0">
                  <dt className="text-sm font-medium">{ROLE_LABELS[role]}</dt>
                  <dd className="mt-0.5 text-sm text-muted-foreground">
                    {ROLE_DESCRIPTIONS[role]}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Everyone who can see contracts sees all of them. Per-person visibility needs
          workspaces, which is a separate piece of work — so invite someone as “Signs only” if
          they should not see your library.
        </p>
      </div>
    </div>
  );
}
