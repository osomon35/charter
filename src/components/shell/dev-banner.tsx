import { TriangleAlert } from "lucide-react";

/**
 * Visible warning when the development link reveal is enabled.
 *
 * REVEAL_SIGNING_LINKS prints live signing credentials into the UI. It is the
 * kind of flag that gets set for one test and then forgotten, and forgetting it
 * in production means every send displays credentials on screen. Better to be
 * impossible to miss than to rely on remembering.
 */
export function DevBanner() {
  if (process.env.REVEAL_SIGNING_LINKS !== "true") return null;

  return (
    <div className="flex items-center gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2 text-xs">
      <TriangleAlert className="size-3.5 shrink-0 text-warning" aria-hidden />
      <span>
        <strong className="font-semibold">REVEAL_SIGNING_LINKS is on.</strong> Signing links
        are shown in the UI. Unset it in Vercel before real use.
      </span>
    </div>
  );
}
