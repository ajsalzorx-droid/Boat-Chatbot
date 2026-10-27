import { adminRoute } from "@/lib/auth/guards";
import { json } from "@/lib/http/api";
import { conversationListQuerySchema } from "@/lib/validation/admin";
import { listConversations } from "@/services/conversations/conversation-service";
import { toConversationSummary } from "@/services/dto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute("agent", async ({ request, session }) => {
  const query = conversationListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  const { items, total } = await listConversations({
    search: query.search,
    status: query.status,
    channel: query.channel,
    assignedTo: query.assigned,
    currentUserId: session.user._id,
    page: query.page,
    pageSize: query.pageSize,
  });
  return json({ items: items.map(toConversationSummary), total, page: query.page, pageSize: query.pageSize });
});
