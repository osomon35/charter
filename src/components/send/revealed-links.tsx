"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * Shows signing links directly in the UI.
 *
 * Only ever reached when REVEAL_SIGNING_LINKS is on — an escape hatch for
 * testing before a sending domain is verified. Each URL is a live credential:
 * whoever opens it can sign as that recipient. Displayed once, never stored,
 * and never shown again after this screen.
 */
export function RevealedLinks({ links }: { links: { email: string; url: string }[] }) {
  const [copied, setCopied] = useState<string | null>(null);

  if (links.length === 0) return null;

  return (
    <Alert className="mt-4">
      <p className="font-medium">Signing links (development reveal)</p>
      <p className="mt-1 text-xs text-muted-foreground">
        REVEAL_SIGNING_LINKS is enabled. Each link lets whoever opens it sign as that
        person — treat them as passwords, and unset the variable once email works.
      </p>

      <ul className="mt-3 space-y-2">
        {links.map((link) => (
          <li key={link.email} className="rounded-md border border-border bg-surface p-2.5">
            <p className="truncate text-xs font-medium">{link.email}</p>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-[11px]">
                {link.url}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link.url);
                    setCopied(link.email);
                    setTimeout(() => setCopied(null), 2000);
                  } catch {
                    // Clipboard can be blocked; the text is selectable anyway.
                  }
                }}
              >
                {copied === link.email ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied === link.email ? "Copied" : "Copy"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Alert>
  );
}
