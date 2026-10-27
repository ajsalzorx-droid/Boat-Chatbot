import { z } from "zod";

import { adminRoute } from "@/lib/auth/guards";
import { json, readJson } from "@/lib/http/api";
import { logger } from "@/lib/logging/logger";
import { idParamsSchema } from "@/lib/validation/admin";
import { toMessageDto } from "@/services/dto";
import { retryOutboundMessage } from "@/services/messages/outbound-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const bodySchema = z.object({ acceptDuplicateRisk: z.boolean().default(false) });

export const POST = adminRoute<{ id: string }>("admin", async ({ params, request, session }) => {
  const { id } = idParamsSchema.parse(params);
  const { acceptDuplicateRisk } = await readJson(request, bodySchema);
  const message = await retryOutboundMessage(id, { acceptDuplicateRisk });
  logger.info("message.retried", { messageId: id.toString(), by: session.user._id.toString(), acceptDuplicateRisk });
  return json({ message: toMessageDto(message) });
});
