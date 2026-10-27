import type { Metadata } from "next";

import { PageHeader } from "@/components/ui";
import { requirePageSession } from "@/lib/auth/guards";

import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "My account" };

export default async function AccountPage() {
  await requirePageSession("agent");
  return (
    <div className="max-w-md">
      <PageHeader title="My account" description="Changing your password signs you out on every other device." />
      <PasswordForm />
    </div>
  );
}
