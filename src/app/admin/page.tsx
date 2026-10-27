import type { Metadata } from "next";

import { requirePageSession } from "@/lib/auth/guards";

import { OverviewClient } from "./overview-client";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  await requirePageSession("agent");
  const { denied } = await searchParams;
  return <OverviewClient denied={denied === "1"} />;
}
