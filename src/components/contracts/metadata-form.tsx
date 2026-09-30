"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import {
  CONTRACT_STATUSES,
  STATUS_LABELS,
  type ContractStatus,
} from "@/lib/contracts/types";
import {
  saveContractMetadata,
  type SaveMetadataState,
} from "@/lib/contracts/actions";

const EMPTY: SaveMetadataState = {};

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save changes"}
    </Button>
  );
}

export function MetadataForm({
  contract,
}: {
  contract: {
    id: string;
    title: string;
    counterparty_name: string | null;
    status: ContractStatus;
    notes: string | null;
    effective_date: string | null;
    expiry_date: string | null;
  };
}) {
  const [state, action] = useActionState(saveContractMetadata, EMPTY);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="id" value={contract.id} />

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.saved ? <Alert tone="success">Saved.</Alert> : null}

      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" defaultValue={contract.title} required maxLength={300} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="counterparty_name">Counterparty</Label>
          <Input
            id="counterparty_name"
            name="counterparty_name"
            defaultValue={contract.counterparty_name ?? ""}
            placeholder="Who is signing with you"
            maxLength={300}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <Select id="status" name="status" defaultValue={contract.status}>
            {CONTRACT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="effective_date">Effective date</Label>
          <Input
            id="effective_date"
            name="effective_date"
            type="date"
            defaultValue={contract.effective_date ?? ""}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="expiry_date">Expiry date</Label>
          <Input
            id="expiry_date"
            name="expiry_date"
            type="date"
            defaultValue={contract.expiry_date ?? ""}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          name="notes"
          defaultValue={contract.notes ?? ""}
          placeholder="Anything worth remembering about this agreement"
          rows={5}
        />
      </div>

      <SaveButton />
    </form>
  );
}
