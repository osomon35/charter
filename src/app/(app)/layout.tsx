import { requireOwner } from "@/lib/auth";
import { SidebarNav } from "@/components/shell/sidebar";
import { SignOutButton } from "@/components/shell/sign-out-button";

/**
 * Every route in this group is gated here. requireOwner() redirects anyone
 * who is not a signed-in, allowlisted owner — and RLS refuses their queries
 * regardless, so a bypass of this layer still reaches no data.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const owner = await requireOwner();

  return (
    <div className="flex min-h-dvh bg-background">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface-muted md:flex">
        <div className="flex h-14 items-center gap-2.5 px-4">
          <div
            aria-hidden
            className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground"
          >
            C
          </div>
          <span className="text-sm font-semibold tracking-tight">Charter</span>
        </div>

        <div className="flex-1 px-2.5 py-2">
          <SidebarNav />
        </div>

        <div className="border-t border-border px-2.5 py-3">
          <div className="px-2.5 pb-2">
            <p className="truncate text-[13px] font-medium">{owner.fullName ?? "Owner"}</p>
            <p className="truncate text-xs text-muted-foreground">{owner.email}</p>
          </div>
          <SignOutButton />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-border md:hidden">
          <header className="flex h-14 items-center justify-between gap-4 px-4">
            <span className="text-sm font-semibold tracking-tight">Charter</span>
            <SignOutButton />
          </header>
          <div className="overflow-x-auto px-2.5 pb-2">
            <div className="flex w-max gap-1">
              <SidebarNav />
            </div>
          </div>
        </div>
        <main className="min-w-0 flex-1 px-6 py-8 md:px-10 md:py-10">{children}</main>
      </div>
    </div>
  );
}
