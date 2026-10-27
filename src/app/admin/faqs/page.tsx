import type { Metadata } from "next";

import { requirePageSession } from "@/lib/auth/guards";

import { FaqsClient } from "./faqs-client";

export const metadata: Metadata = { title: "FAQs" };

export default async function FaqsPage() {
  await requirePageSession("admin");
  return <FaqsClient />;
}
