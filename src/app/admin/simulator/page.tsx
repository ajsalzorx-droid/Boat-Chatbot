import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requirePageSession } from "@/lib/auth/guards";
import { isSimulatorEnabled } from "@/lib/config/env";

import { SimulatorClient } from "./simulator-client";

export const metadata: Metadata = { title: "Simulator" };

export default async function SimulatorPage() {
  await requirePageSession("admin");
  if (!isSimulatorEnabled()) redirect("/admin");
  return <SimulatorClient />;
}
