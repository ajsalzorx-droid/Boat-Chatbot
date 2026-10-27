import "server-only";

import { getConfigStatus, type ConfigStatus } from "@/lib/config/env";
import { connectToDatabase, pingDatabase } from "@/lib/db/mongoose";
import { Conversation } from "@/models/conversation";
import { Message } from "@/models/message";
import { ProcessingJob, type JobStatus } from "@/models/processing-job";
import { WebhookEvent } from "@/models/webhook-event";
import { toJobDto, type JobDto } from "@/services/dto";

/** Operational status for the admin System Health page. Never includes secret values. */

export interface HealthReport {
  config: ConfigStatus;
  database: { ok: boolean; latencyMs: number | null };
  webhook: { lastReceivedAt: string | null; received24h: number; failed24h: number; unmatchedStatuses: number };
  queue: { mode: string; counts: Partial<Record<JobStatus, number>>; problemJobs: JobDto[] };
  failedMessages: { id: string; conversationId: string; status: string; code: string; title: string; createdAt: string }[];
  recentEvents: { kind: string; field: string; status: string; note: string | null; receivedAt: string }[];
  warnings: string[];
}

export async function getHealthReport(): Promise<HealthReport> {
  const config = getConfigStatus();
  const db = await pingDatabase();
  const warnings: string[] = [];

  if (!config.whatsapp.configured) warnings.push("WhatsApp is not fully configured; messages cannot be sent or received.");
  if (config.queue.configured && config.queue.mode === "inline" && process.env.NODE_ENV === "production") {
    warnings.push("QStash is not configured: production is running the inline queue. Configure QStash for reliable processing.");
  }
  if (!config.cron.configured) warnings.push("CRON_SECRET is not set: scheduled recovery and retention cannot run.");
  if (!config.ai.enabled) warnings.push(`AI is off (${config.ai.reason ?? "not configured"}); the bot answers from FAQs and rules only.`);

  if (!db.ok) {
    return {
      config,
      database: { ok: false, latencyMs: null },
      webhook: { lastReceivedAt: null, received24h: 0, failed24h: 0, unmatchedStatuses: 0 },
      queue: { mode: config.queue.mode ?? "unknown", counts: {}, problemJobs: [] },
      failedMessages: [],
      recentEvents: [],
      warnings: ["Database unreachable.", ...warnings],
    };
  }

  await connectToDatabase();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [lastEvent, received24h, failed24h, unmatchedStatuses, jobCounts, problemJobs, failedMessages, recentEvents] = await Promise.all([
    WebhookEvent.findOne().sort({ receivedAt: -1 }).select({ receivedAt: 1 }).lean(),
    WebhookEvent.countDocuments({ receivedAt: { $gte: since } }),
    WebhookEvent.countDocuments({ receivedAt: { $gte: since }, status: "failed" }),
    WebhookEvent.countDocuments({ status: "unmatched" }),
    ProcessingJob.aggregate<{ _id: JobStatus; count: number }>([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ProcessingJob.find({ status: { $in: ["dead", "failed", "retry_scheduled"] } }).sort({ updatedAt: -1 }).limit(25).lean(),
    Message.find({ direction: "outbound", status: { $in: ["failed", "unknown"] } }).sort({ createdAt: -1 }).limit(25).lean(),
    WebhookEvent.find().sort({ receivedAt: -1 }).limit(20).lean(),
  ]);

  return {
    config,
    database: { ok: true, latencyMs: db.latencyMs },
    webhook: {
      lastReceivedAt: lastEvent?.receivedAt.toISOString() ?? null,
      received24h,
      failed24h,
      unmatchedStatuses,
    },
    queue: {
      mode: config.queue.mode ?? "unknown",
      counts: Object.fromEntries(jobCounts.map((entry) => [entry._id, entry.count])),
      problemJobs: problemJobs.map(toJobDto),
    },
    failedMessages: failedMessages.map((message) => ({
      id: message._id.toString(),
      conversationId: message.conversationId.toString(),
      status: message.status,
      code: String(message.error?.code ?? ""),
      title: message.error?.title ?? "",
      createdAt: message.createdAt.toISOString(),
    })),
    recentEvents: recentEvents.map((event) => ({
      kind: event.kind,
      field: event.field,
      status: event.status,
      note: event.lastError,
      receivedAt: event.receivedAt.toISOString(),
    })),
    warnings,
  };
}

export interface OverviewStats {
  totalConversations: number;
  newEnquiries: number;
  activeConversations: number;
  unanswered: number;
  needsHuman: number;
  failedOutbound7d: number;
  messagesToday: { inbound: number; bot: number; agent: number };
  botSources7d: Record<string, number>;
  daily: { date: string; inbound: number; outbound: number }[];
}

export async function getOverviewStats(timezone: string): Promise<OverviewStats> {
  await connectToDatabase();
  const now = Date.now();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

  const [total, fresh, active, unanswered, needsHuman, failed, today, sources, daily] = await Promise.all([
    Conversation.countDocuments({ channel: "whatsapp" }),
    Conversation.countDocuments({ channel: "whatsapp", status: "new" }),
    Conversation.countDocuments({ channel: "whatsapp", status: { $ne: "resolved" }, lastMessageAt: { $gte: dayAgo } }),
    Conversation.countDocuments({
      channel: "whatsapp",
      status: { $ne: "resolved" },
      $expr: { $gt: ["$lastInboundAt", { $ifNull: ["$lastOutboundAt", new Date(0)] }] },
    }),
    Conversation.countDocuments({ channel: "whatsapp", status: "needs_human" }),
    Message.countDocuments({ channel: "whatsapp", direction: "outbound", status: { $in: ["failed", "unknown"] }, createdAt: { $gte: weekAgo } }),
    Message.aggregate<{ _id: string; count: number }>([
      { $match: { channel: "whatsapp", createdAt: { $gte: dayAgo } } },
      { $group: { _id: "$sender", count: { $sum: 1 } } },
    ]),
    Message.aggregate<{ _id: string | null; count: number }>([
      { $match: { channel: "whatsapp", sender: "bot", createdAt: { $gte: weekAgo } } },
      { $group: { _id: "$botMeta.source", count: { $sum: 1 } } },
    ]),
    Message.aggregate<{ _id: { date: string; direction: string }; count: number }>([
      { $match: { channel: "whatsapp", createdAt: { $gte: weekAgo } } },
      {
        $group: {
          _id: { date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone } }, direction: "$direction" },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const bySender = Object.fromEntries(today.map((entry) => [entry._id, entry.count]));
  const days = new Map<string, { inbound: number; outbound: number }>();
  for (const entry of daily) {
    const day = days.get(entry._id.date) ?? { inbound: 0, outbound: 0 };
    if (entry._id.direction === "inbound") day.inbound += entry.count;
    else day.outbound += entry.count;
    days.set(entry._id.date, day);
  }

  return {
    totalConversations: total,
    newEnquiries: fresh,
    activeConversations: active,
    unanswered,
    needsHuman,
    failedOutbound7d: failed,
    messagesToday: { inbound: bySender.customer ?? 0, bot: bySender.bot ?? 0, agent: bySender.agent ?? 0 },
    botSources7d: Object.fromEntries(sources.map((entry) => [entry._id ?? "unknown", entry.count])),
    daily: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, counts]) => ({ date, ...counts })),
  };
}
