import { adminRoute, hasAccess } from "@/lib/auth/guards";
import { AppError } from "@/lib/errors/app-error";
import { json, readJson } from "@/lib/http/api";
import { logger } from "@/lib/logging/logger";
import { customerServiceWindow } from "@/lib/whatsapp/policy";
import { conversationUpdateSchema, idParamsSchema } from "@/lib/validation/admin";
import { AdminUser } from "@/models/admin-user";
import { eraseConversation, getConversation, updateConversation } from "@/services/conversations/conversation-service";
import { toConversationDetail } from "@/services/dto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute<{ id: string }>("agent", async ({ params }) => {
  const { id } = idParamsSchema.parse(params);
  const conversation = await getConversation(id);
  return json({ conversation: toConversationDetail(conversation, customerServiceWindow(conversation.lastInboundAt).closesAt) });
});

export const PATCH = adminRoute<{ id: string }>("agent", async ({ request, params, session }) => {
  const { id } = idParamsSchema.parse(params);
  const update = await readJson(request, conversationUpdateSchema);
  if (update.assignedAgentId) {
    const agent = await AdminUser.exists({ _id: update.assignedAgentId, active: true });
    if (!agent) throw new AppError("Unknown agent", { code: "VALIDATION_FAILED", httpStatus: 400, publicMessage: "That team member does not exist." });
  }
  const conversation = await updateConversation(id, update);
  logger.info("conversation.updated", { conversationId: id.toString(), by: session.user._id.toString(), fields: Object.keys(update) });
  return json({ conversation: toConversationDetail(conversation, customerServiceWindow(conversation.lastInboundAt).closesAt) });
});

/** Permanent erasure (customer data deletion request). Admins only. */
export const DELETE = adminRoute<{ id: string }>("agent", async ({ params, session }) => {
  if (!hasAccess(session.user.role, "admin")) {
    throw new AppError("Insufficient role", { code: "FORBIDDEN", httpStatus: 403, publicMessage: "Only administrators can delete customer data." });
  }
  const { id } = idParamsSchema.parse(params);
  const result = await eraseConversation(id);
  logger.info("conversation.erased", { conversationId: id.toString(), by: session.user._id.toString(), messages: result.messagesDeleted });
  return json({ deleted: true, ...result });
});
