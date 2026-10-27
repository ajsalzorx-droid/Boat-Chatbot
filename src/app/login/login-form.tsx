"use client";

import { useState, type SubmitEvent } from "react";

import { Button, Card, ErrorBanner, Field, Input } from "@/components/ui";
import { api, errorMessage } from "@/lib/client/api";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", body: { email, password } });
      window.location.href = "/admin";
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <ErrorBanner message={error} />
        <Field label="Email">
          <Input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </Card>
  );
}
