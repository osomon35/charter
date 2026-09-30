import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="mt-1 text-lg font-semibold tracking-tight">Not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          That page does not exist, or you do not have access to it.
        </p>
        <Link href="/dashboard" className={`${buttonVariants({ variant: "outline" })} mt-6`}>
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
