import "server-only";

import { connectToDatabase } from "@/lib/db/mongoose";
import type { DeliveryStatus, StatusEvent } from "@/lib/whatsapp/types";
import { Message, type MessageStatus } from "@/models/message";

/**
 * Applies delivery-status webhooks without ever moving a message backwards.
 *
 * Meta can deliver statuses late, twice, or out of order (e.g. `read` before `delivered`).
 * Each status may only replace the states listed below, so an older event can never overwrite a
 * newer one. The earliest report of each stage is kept as its timestamp.
 */
const REPLACEABLE: Record<DeliveryStatus, readonly MessageStatus[]> = {
  sent: ["pending", "sending", "unknown", "accepted"],
  delivered: ["pending", "sending", "unknown", "accepted", "sent"],
  read: ["pending", "sending", "unknown", "accepted", "sent", "delivered"],
  failed: ["pending", "sending", "unknown", "accepted", "sent"],
};

const TIMESTAMP_FIELD: Record<DeliveryStatus, string> = {
  sent: "statusTimestamps.sentAt",
  delivered: "statusTimestamps.deliveredAt",
  read: "statusTimestamps.readAt",
  failed: "statusTimestamps.failedAt",
};

export type StatusApplyResult = "applied" | "stale" | "unmatched";

export async function applyStatusEvent(event: StatusEvent): Promise<StatusApplyResult> {
  await connectToDatabase();

  // Aggregation $min ignores null, so the first report sets the field and later ones keep the
  // earliest. (The update operator $min would treat the schema default null as smallest.)
  const field = TIMESTAMP_FIELD[event.status];
  const exists = await Message.updateOne(
    { whatsappMessageId: event.messageId, direction: "outbound" },
    [{ $set: { [field]: { $min: ["$" + field, event.occurredAt] } } }],
    { updatePipeline: true },
  );
  if (exists.matchedCount === 0) return "unmatched";

  const firstError = event.errors[0];
  const result = await Message.updateOne(
    { whatsappMessageId: event.messageId, direction: "outbound", status: { $in: REPLACEABLE[event.status] } },
    {
      $set: {
        status: event.status,
        ...(event.status === "failed" && firstError
          ? { error: { code: firstError.code, title: firstError.title.slice(0, 300), details: firstError.details?.slice(0, 1000) ?? null } }
          : {}),
      },
    },
  );
  return result.modifiedCount > 0 ? "applied" : "stale";
}
