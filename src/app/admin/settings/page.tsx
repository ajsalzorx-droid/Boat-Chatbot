import type { Metadata } from "next";

import { requirePageSession } from "@/lib/auth/guards";

import { SettingsClient } from "./settings-client";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requirePageSession("admin");
  return <SettingsClient />;
}
