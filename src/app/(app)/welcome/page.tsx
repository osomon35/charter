import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/members/types";
import { SetupForm } from "@/components/settings/setup-form";

export const metadata: Metadata = {
  title: "Welcome",
  robots: { index: false, follow: false },
};

/**
 * Where an invite link lands.
 *
 * The visitor is already signed in by the time they get here — the auth callback
 * verified the invite token — so this is not a signup. The account exists and was
 * created by an admin with a password nobody knows, which is why the only thing
 * asked for is a password of their own, plus the name recipients will see.
 *
 * requireOwner rather than requireContractAccess: someone invited to sign only
 * still needs to finish setting up.
 */
export default async function WelcomePage() {
  const owner = await requireOwner();

  return (
    <main className="mx-auto max-w-sm py-6">
      <h1 className="text-xl font-semibold tracking-tight">Welcome to Charter</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        You are signed in. Set a password so you can get back in without waiting for an
        email.
      </p>

      <div className="mt-5 rounded-lg border border-border bg-surface-muted p-3">
        <p className="text-xs font-medium">
          Your access: {ROLE_LABELS[owner.role]}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {ROLE_DESCRIPTIONS[owner.role]}
        </p>
      </div>

      <div className="mt-6">
        <SetupForm email={owner.email} defaultName={owner.fullName} />
      </div>

      <p className="mt-8 text-xs leading-relaxed text-muted-foreground">
        Signing a document here relies on your intent to sign and on a recorded audit trail —
        a simple electronic signature under ESIGN and eIDAS. Charter is not a qualified or
        notarised signature service.
      </p>
    </main>
  );
}
