import type { Metadata } from "next";

import { requirePageSession } from "@/lib/auth/guards";

import { HealthClient } from "./health-client";

export const metadata: Metadata = { title: "System health" };

export default async function HealthPage() {
  await requirePageSession("admin");
  return <HealthClient />;
}
