import type { Metadata } from "next";

import { requirePageSession } from "@/lib/auth/guards";

import { WhatsAppConnectClient } from "./whatsapp-connect-client";

export const metadata: Metadata = { title: "WhatsApp connection" };

export default async function WhatsAppConnectionPage() {
  await requirePageSession("owner");
  return <WhatsAppConnectClient />;
}
