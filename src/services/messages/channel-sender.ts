import "server-only";

import { AppError } from "@/lib/errors/app-error";
import { WhatsAppClient } from "@/lib/whatsapp/client";
import type { Channel } from "@/models/conversation";

/**
 * Delivery per channel. The simulator channel never contacts WhatsApp: its messages are stored
 * as `simulated` and shown only in the dashboard.
 */

export interface Recipient {
  waId: string | null;
  userId: string | null;
}

export type SendOutcome = { kind: "sent"; messageId: string } | { kind: "simulated" };

export interface ChannelSender {
  sendText(recipient: Recipient, body: string, replyToMessageId: string | null): Promise<SendOutcome>;
  sendTemplate(recipient: Recipient, template: { name: string; languageCode: string }): Promise<SendOutcome>;
}

function requireWaId(recipient: Recipient): string {
  if (recipient.waId) return recipient.waId;
  // Sending to username-only customers (business-scoped user IDs) is not yet supported by this platform.
  throw new AppError("Customer has no phone-based WhatsApp ID", {
    code: "VALIDATION_FAILED",
    httpStatus: 422,
    publicMessage: "This customer can only be reached by replying in WhatsApp directly.",
  });
}

class WhatsAppSender implements ChannelSender {
  private client: WhatsAppClient | null = null;

  private getClient(): WhatsAppClient {
    this.client ??= new WhatsAppClient();
    return this.client;
  }

  async sendText(recipient: Recipient, body: string, replyToMessageId: string | null): Promise<SendOutcome> {
    const result = await this.getClient().sendText({ to: requireWaId(recipient), body, replyToMessageId });
    return { kind: "sent", messageId: result.messageId };
  }

  async sendTemplate(recipient: Recipient, template: { name: string; languageCode: string }): Promise<SendOutcome> {
    const result = await this.getClient().sendTemplate({ to: requireWaId(recipient), ...template });
    return { kind: "sent", messageId: result.messageId };
  }
}

class SimulatorSender implements ChannelSender {
  sendText(): Promise<SendOutcome> {
    return Promise.resolve({ kind: "simulated" });
  }

  sendTemplate(): Promise<SendOutcome> {
    return Promise.resolve({ kind: "simulated" });
  }
}

let override: Partial<Record<Channel, ChannelSender>> = {};

export function getChannelSender(channel: Channel): ChannelSender {
  const replaced = override[channel];
  if (replaced) return replaced;
  return channel === "simulator" ? new SimulatorSender() : new WhatsAppSender();
}

/** Tests replace the WhatsApp sender with a fake; never used in application code. */
export function setChannelSenderForTests(channel: Channel, sender: ChannelSender | null): void {
  if (sender) override = { ...override, [channel]: sender };
  else override = Object.fromEntries(Object.entries(override).filter(([key]) => key !== channel));
}
