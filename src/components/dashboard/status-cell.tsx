"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { setContractStatus } from "@/lib/contracts/organise-actions";
import {
  CONTRACT_STATUSES,
  STATUS_CLASSES,
  STATUS_LABELS,
  type ContractStatus,
} from "@/lib/contracts/types";
import { Popover } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Click the status badge to change it.
 *
 * Optimistic: the badge changes on click and the server call confirms it. Status
 * is a label the owner maintains, not a derived value, so there is nothing for a
 * failed write to corrupt — and a round trip before the badge moves would make a
 * one-click edit feel like a form submission.
 */
export function StatusCell({
  contractId,
  status,
}: {
  contractId: string;
  status: ContractStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(status);

  return (
    <Popover
      trigger={() => (
        <Badge
          className={cn(
            STATUS_CLASSES[shown],
            "cursor-pointer hover:ring-1 hover:ring-primary",
            pending ? "opacity-60" : "",
          )}
        >
          {STATUS_LABELS[shown]}
        </Badge>
      )}
    >
      {(close) => (
        <ul>
          {CONTRACT_STATUSES.map((option) => (
            <li key={option}>
              <button
                type="button"
                onClick={() => {
                  close();
                  startTransition(async () => {
                    setShown(option);
                    await setContractStatus({ contractId, status: option });
                    router.refresh();
                  });
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
              >
                <Check
                  className={cn("size-3 shrink-0", option === shown ? "" : "invisible")}
                  aria-hidden
                />
                <Badge className={STATUS_CLASSES[option]}>{STATUS_LABELS[option]}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}
