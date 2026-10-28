import type { Metadata } from "next";

import { requirePageSession } from "@/lib/auth/guards";

import { OffersClient } from "./offers-client";

export const metadata: Metadata = { title: "Offer alerts" };

export default async function OffersPage() {
  await requirePageSession("admin");
  return <OffersClient />;
}
