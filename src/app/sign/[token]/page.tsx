import type { Metadata } from "next";
import { resolveSignerToken } from "@/lib/envelopes/signer";
import { clientIp, consume } from "@/lib/rate-limit";
import { SignerExperience } from "@/components/signer/signer-experience";

export const metadata: Metadata = {
  title: "Review & sign",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The only route on this deployment that anyone on the internet can reach
 * usefully. Rate limited before the token is even hashed, and every refusal
 * looks the same from outside — an expired link, a wrong link and someone
 * else's turn are not distinguishable by a prober, though the owner's audit
 * trail records what actually happened.
 */
export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const ip = await clientIp();
  const limit = await consume(`sign-page:ip:${ip}`, 40, 600);
  if (!limit.ok) {
    return (
      <Notice
        title="Too many attempts"
        body="Please wait a few minutes and open your link again."
      />
    );
  }

  const lookup = await resolveSignerToken(token);

  if (!lookup.ok) {
    switch (lookup.reason) {
      case "expired":
        return (
          <Notice
            title="This link has expired"
            body="Signing links are valid for a limited time. Contact the person who sent it and they can send you a new one."
          />
        );
      case "done":
        return (
          <Notice
            title="Already signed"
            body="This document has been signed. A copy is emailed to everyone once all parties are done."
          />
        );
      case "declined":
        return (
          <Notice
            title="Already declined"
            body="This document was declined. The sender has been told."
          />
        );
      case "waiting":
        return (
          <Notice
            title="Not your turn yet"
            body="This document is being signed in order, and someone before you has not signed yet. You will be emailed as soon as it reaches you."
          />
        );
      case "voided":
        return (
          <Notice
            title="This request was cancelled"
            body="The sender cancelled this signing request. Contact them if you were expecting to sign."
          />
        );
      default:
        return (
          <Notice
            title="This link is not valid"
            body="It may have been mistyped, already used, or cancelled. Contact the person who sent it."
          />
        );
    }
  }

  const { context } = lookup;

  return (
    <SignerExperience
      token={token}
      documentTitle={context.document.title}
      senderMessage={context.envelope.message}
      recipientName={context.recipient.name}
      pageCount={context.document.pageCount}
      fields={context.fields}
      alreadyConsented={Boolean(context.recipient.consentedAt)}
    />
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <div
          aria-hidden
          className="mx-auto mb-6 flex size-9 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground"
        >
          C
        </div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </main>
  );
}
