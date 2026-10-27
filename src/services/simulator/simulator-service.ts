import "server-only";

import { randomUUID } from "node:crypto";

import { isSimulatorEnabled } from "@/lib/config/env";
import { AppError } from "@/lib/errors/app-error";
import { Conversation } from "@/models/conversation";
import { runJob } from "@/services/jobs/queue";
import { ingestEvents } from "@/services/webhooks/ingest-service";

/**
 * Demo simulator: a customer message typed in the dashboard goes through the same ingest, job and
 * chatbot pipeline as a real WhatsApp message, on the separate `simulator` channel. Replies are
 * stored as `simulated` and never sent to WhatsApp.
 */
export async function simulateCustomerMessage(input: { customerId: string; customerName: string; text: string }): Promise<{ conversationId: string }> {
  if (!isSimulatorEnabled()) {
    throw new AppError("Simulator disabled", { code: "FORBIDDEN", httpStatus: 403, publicMessage: "The simulator is disabled on this deployment." });
  }

  const now = new Date();
  const result = await ingestEvents(
    [
      {
        kind: "message",
        phoneNumberId: "simulator",
        messageId: `sim.${randomUUID()}`,
        customer: { waId: `sim-${input.customerId.toLowerCase()}`, userId: null, profileName: input.customerName },
        sentAt: now,
        content: { type: "text", body: input.text },
        replyToMessageId: null,
      },
    ],
    { channel: "simulator", expectedPhoneNumberId: null, receivedAt: now },
  );

  // Run synchronously so the reply is ready when the dashboard refreshes.
  for (const job of result.jobs) await runJob(job.id);

  const conversation = await Conversation.findOne({ channel: "simulator", customerKey: `sim-${input.customerId.toLowerCase()}` }).select({ _id: 1 }).lean();
  if (!conversation) throw new Error("Simulator conversation missing after ingest");
  return { conversationId: conversation._id.toString() };
}
