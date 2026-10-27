import type { Metadata } from "next";

import { requirePageSession } from "@/lib/auth/guards";

import { ConversationsClient } from "./conversations-client";

export const metadata: Metadata = { title: "Conversations" };

export default async function ConversationsPage() {
  await requirePageSession("agent");
  return <ConversationsClient />;
}
