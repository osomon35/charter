import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Review & sign",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The only route reachable without a session. Real behaviour lands in Phase 5;
 * for now it proves the public path exists and that middleware lets it past
 * without leaking anything about whether a token is valid.
 */
export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  // Awaited but intentionally unused: tokens are never rendered or logged.
  await params;

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <div
          aria-hidden
          className="mx-auto mb-6 flex size-9 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground"
        >
          C
        </div>
        <h1 className="text-lg font-semibold tracking-tight">This link is not ready yet</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Signing has not been enabled on this workspace. If you were expecting a
          document, please contact the person who sent you this link.
        </p>
      </div>
    </main>
  );
}
