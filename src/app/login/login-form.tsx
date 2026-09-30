"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { sendMagicLink, signInWithPassword, type LoginState } from "./actions";

const EMPTY: LoginState = {};

function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "One moment…" : children}
    </Button>
  );
}

export function LoginForm({ next, initialError }: { next?: string; initialError?: string }) {
  const [mode, setMode] = useState<"password" | "link">("password");
  const [pwState, pwAction] = useActionState(signInWithPassword, EMPTY);
  const [linkState, linkAction] = useActionState(sendMagicLink, EMPTY);

  const state = mode === "password" ? pwState : linkState;
  const error = state.error ?? initialError;

  return (
    <div className="space-y-5">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {state.notice ? <Alert tone="success">{state.notice}</Alert> : null}

      {mode === "password" ? (
        <form action={pwAction} className="space-y-4">
          <input type="hidden" name="next" value={next ?? ""} />
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              defaultValue={state.email ?? ""}
              aria-invalid={error ? true : undefined}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={error ? true : undefined}
            />
          </div>
          <Submit>Sign in</Submit>
        </form>
      ) : (
        <form action={linkAction} className="space-y-4">
          <input type="hidden" name="next" value={next ?? ""} />
          <div className="space-y-2">
            <Label htmlFor="link-email">Email</Label>
            <Input
              id="link-email"
              name="email"
              type="email"
              autoComplete="username"
              required
              defaultValue={state.email ?? ""}
            />
          </div>
          <Submit>Email me a sign-in link</Submit>
        </form>
      )}

      <div className="border-t border-border pt-4 text-center">
        <button
          type="button"
          onClick={() => setMode(mode === "password" ? "link" : "password")}
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {mode === "password" ? "Use a sign-in link instead" : "Use a password instead"}
        </button>
      </div>
    </div>
  );
}
