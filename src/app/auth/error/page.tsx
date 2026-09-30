import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function AuthErrorPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          That sign-in attempt could not be completed. Please try again.
        </p>
        <Link href="/login" className={`${buttonVariants({ variant: "outline" })} mt-6`}>
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
