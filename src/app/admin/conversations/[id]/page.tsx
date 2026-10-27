import type { Metadata } from "next";

import { hasAccess, requirePageSession } from "@/lib/auth/guards";

import { ConversationDetailClient } from "./conversation-detail-client";

export const metadata: Metadata = { title: "Conversation" };

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requirePageSession("agent");
  return (
    <ConversationDetailClient
      id={id}
      currentUserId={session.user._id.toString()}
      canDelete={hasAccess(session.user.role, "admin")}
      canRetry={hasAccess(session.user.role, "admin")}
    />
  );
}
