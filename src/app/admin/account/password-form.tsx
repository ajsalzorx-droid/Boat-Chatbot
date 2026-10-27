"use client";

import { useState, type SubmitEvent } from "react";

import { Button, Card, ErrorBanner, Field, Input, Notice } from "@/components/ui";
import { api, errorMessage } from "@/lib/client/api";

export function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    setError(null);
    setDone(false);
    if (newPassword !== confirm) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/admin/account/password", { method: "POST", body: { currentPassword, newPassword } });
      setDone(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={(event) => void submit(event)} className="space-y-3">
        <ErrorBanner message={error} />
        {done ? <Notice tone="green">Password changed.</Notice> : null}
        <Field label="Current password">
          <Input type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
        </Field>
        <Field label="New password" hint="At least 12 characters">
          <Input type="password" autoComplete="new-password" required minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        </Field>
        <Field label="Confirm new password">
          <Input type="password" autoComplete="new-password" required minLength={12} value={confirm} onChange={(event) => setConfirm(event.target.value)} />
        </Field>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Change password"}
        </Button>
      </form>
    </Card>
  );
}
