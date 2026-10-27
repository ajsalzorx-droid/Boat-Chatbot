import { AdminSession } from "./admin-session";
import { AdminUser } from "./admin-user";
import { CompanySettings } from "./company-settings";
import { Conversation } from "./conversation";
import { Faq } from "./faq";
import { Message } from "./message";
import { ProcessingJob } from "./processing-job";
import { Product } from "./product";
import { RateLimit } from "./rate-limit";
import { WebhookEvent } from "./webhook-event";
import { WhatsAppConnection } from "./whatsapp-connection";

export { AdminSession, AdminUser, CompanySettings, Conversation, Faq, Message, ProcessingJob, Product, RateLimit, WebhookEvent, WhatsAppConnection };

/** The subset of the Mongoose model API that index maintenance needs. */
export interface IndexedModel {
  modelName: string;
  createCollection(): Promise<unknown>;
  createIndexes(): Promise<unknown>;
  diffIndexes(): Promise<{ toDrop: unknown[]; toCreate: unknown[] }>;
}

/**
 * Registry of every model whose indexes must exist in production.
 *
 * `npm run db:sync-indexes` builds the indexes declared on these models. Unique indexes enforce
 * idempotency (WhatsApp message IDs, webhook event keys, job keys), so a new model is only safe
 * to deploy once it is listed here and the sync has run.
 */
export function getRegisteredModels(): readonly IndexedModel[] {
  return [
    CompanySettings,
    Conversation,
    Message,
    Faq,
    Product,
    AdminUser,
    AdminSession,
    WebhookEvent,
    ProcessingJob,
    RateLimit,
    WhatsAppConnection,
  ];
}
