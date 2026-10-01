"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, LayoutDashboard, Settings, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, needs: "contracts" },
  { href: "/contracts", label: "Contracts", icon: FileText, needs: "contracts" },
  { href: "/members", label: "Members", icon: Users, needs: "admin" },
  { href: "/settings", label: "Settings", icon: Settings, needs: "any" },
] as const;

/**
 * Navigation reflects the role, so a signer is not shown doors that would turn
 * them away and an admin's tools are not advertised to everyone. The gate is
 * still requireAdmin / RLS; this is only about not offering dead ends.
 */
export function SidebarNav({ role }: { role: "admin" | "sender" | "signer" }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-row gap-1 md:flex-col md:gap-0.5" aria-label="Main">
      {NAV.filter((entry) =>
        entry.needs === "any"
          ? true
          : entry.needs === "admin"
            ? role === "admin"
            : role !== "signer",
      ).map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
              active
                ? "bg-primary-subtle font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
