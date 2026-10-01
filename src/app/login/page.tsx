import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in · Charter",
  robots: { index: false, follow: false },
};

const ERRORS: Record<string, string> = {
  not_permitted: "That account no longer has access.",
  link_invalid: "That sign-in link has expired or was already used.",
  invite_invalid:
    "That invite link has expired or was already used. Ask whoever invited you to send another.",
  admin_only: "That page is only available to admins.",
  signer_only: "Your account is set up to sign documents only.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <div className="mb-6 flex items-center gap-2.5">
            <div
              aria-hidden
              className="flex size-8 items-center justify-center rounded-md bg-primary text-[13px] font-semibold text-primary-foreground"
            >
              C
            </div>
            <span className="text-[15px] font-semibold tracking-tight">Charter</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            This workspace is private. Access is limited to approved addresses.
          </p>
        </div>

        <LoginForm next={next} initialError={error ? ERRORS[error] : undefined} />

        <p className="mt-10 text-xs leading-relaxed text-muted-foreground">
          Signing a document here relies on your intent to sign and on a recorded audit
          trail — a simple electronic signature under ESIGN and eIDAS. Charter is not a
          qualified or notarised signature service.{" "}
          <Link href="/legal" className="underline underline-offset-2 hover:text-foreground">
            Read the notice
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
