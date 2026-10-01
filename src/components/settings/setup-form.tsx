"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { completeSetup, type SetupState } from "@/lib/profile/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";

const EMPTY: SetupState = {};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Saving…" : "Finish setting up"}
    </Button>
  );
}

export function SetupForm({
  email,
  defaultName,
}: {
  email: string;
  defaultName: string | null;
}) {
  const router = useRouter();
  const [state, action] = useActionState(completeSetup, EMPTY);

  useEffect(() => {
    if (state.done) router.replace("/dashboard");
  }, [state.done, router]);

  return (
    <form action={action} className="space-y-5">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      <div className="space-y-2">
        <Label>Email</Label>
        <Input value={email} readOnly disabled />
        <p className="text-xs text-muted-foreground">
          This is the address you were invited on and cannot be changed here.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="fullName">Your name</Label>
        <Input
          id="fullName"
          name="fullName"
          defaultValue={defaultName ?? ""}
          placeholder="Ana Ferreira"
          required
          maxLength={200}
          autoFocus
        />
        <p className="text-xs text-muted-foreground">
          Shown to anyone you send a document to.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Choose a password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
        />
        <p className="text-xs text-muted-foreground">At least 10 characters.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
        />
      </div>

      <Submit />
    </form>
  );
}
