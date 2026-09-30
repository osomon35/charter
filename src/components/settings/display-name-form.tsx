"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { saveDisplayName, type SaveProfileState } from "@/lib/profile/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";

const EMPTY: SaveProfileState = {};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

export function DisplayNameForm({ fullName }: { fullName: string | null }) {
  const [state, action] = useActionState(saveDisplayName, EMPTY);

  return (
    <form action={action} className="space-y-3">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.saved ? <Alert tone="success">Saved.</Alert> : null}

      <div className="space-y-2">
        <Label htmlFor="fullName">Your name</Label>
        <Input
          id="fullName"
          name="fullName"
          defaultValue={fullName ?? ""}
          placeholder="Joao Bernardo"
          maxLength={200}
        />
        <p className="text-xs text-muted-foreground">
          Recipients see this in the From line of a signing request.
        </p>
      </div>

      <Submit />
    </form>
  );
}
