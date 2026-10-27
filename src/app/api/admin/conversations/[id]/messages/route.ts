import { adminRoute } from "@/lib/auth/guards";
import { json, readJson } from "@/lib/http/api";
import { idParamsSchema, replySchema } from "@/lib/validation/admin";
import { connectToDatabase } from "@/lib/db/mongoose";
import { Message } from "@/models/message";
import { getConversation } from "@/services/conversations/conversation-service";
import { toMessageDto } from "@/services/dto";
import { sendAgentReply, sendReengagementTemplate } from "@/services/messages/outbound-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = adminRoute<{ id: string }>("agent", async ({ params, request }) => {
  const { id } = idParamsSchema.parse(params);
  await connectToDatabase();
  const limit = Math.min(200, Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? "100") || 100));
  const messages = await Message.find({ conversationId: id }).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
  return json({ items: messages.reverse().map(toMessageDto) });
});

/** Staff reply. Sends through WhatsApp immediately; policy and idempotency are enforced in the service. */
export const POST = adminRoute<{ id: string }>("agent", async ({ params, request, session }) => {
  const { id } = idParamsSchema.parse(params);
  const body = await readJson(request, replySchema, 20_000);
  const conversation = await getConversation(id);
  const message =
    body.kind === "text"
      ? await sendAgentReply({ conversation, agentId: session.user._id, text: body.text, clientRequestId: body.clientRequestId })
      : await sendReengagementTemplate({ conversation, agentId: session.user._id, clientRequestId: body.clientRequestId });
  return json({ message: toMessageDto(message) }, { status: 201 });
});
