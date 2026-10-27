import "server-only";

import { connectToDatabase } from "@/lib/db/mongoose";
import { logger } from "@/lib/logging/logger";
import { getQueueConfig } from "@/lib/config/env";
import { Conversation } from "@/models/conversation";
import { Message } from "@/models/message";
import { reapplyUnmatchedStatuses } from "@/services/webhooks/ingest-service";
import { getSettings } from "@/services/settings/settings-service";

import { findRecoverableJobs } from "./job-service";
import { dispatchJob, runJob } from "./queue";

/**
 * Scheduled recovery (Vercel Cron, or "Run recovery now" in System Health):
 * 1. re-dispatches jobs that are stuck (never dispatched, retry due, crashed worker);
 * 2. re-applies delivery statuses that arrived before their message was stored;
 * 3. enforces the message retention period.
 */

export interface RecoveryReport {
  jobsRecovered: number;
  statusesReapplied: number;
  messagesDeleted: number;
  conversationsDeleted: number;
}

const TIME_BUDGET_MS = 45_000;

export async function runRecovery(): Promise<RecoveryReport> {
  await connectToDatabase();
  const startedAt = Date.now();
  const jobs = await findRecoverableJobs(50);
  const queue = getQueueConfig();

  let jobsRecovered = 0;
  for (const job of jobs) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    if (queue.mode === "qstash") await dispatchJob(job._id);
    else await runJob(job._id);
    jobsRecovered += 1;
  }

  const statusesReapplied = await reapplyUnmatchedStatuses();
  const retention = await enforceRetention();
  const report = { jobsRecovered, statusesReapplied, ...retention };
  logger.info("recovery.completed", { ...report });
  return report;
}

/** Deletes messages older than the retention period, then conversations left empty. */
export async function enforceRetention(): Promise<{ messagesDeleted: number; conversationsDeleted: number }> {
  const settings = await getSettings();
  const cutoff = new Date(Date.now() - settings.retention.messageRetentionDays * 24 * 60 * 60 * 1000);
  const messages = await Message.deleteMany({ createdAt: { $lt: cutoff } });
  const conversations = await Conversation.deleteMany({ lastMessageAt: { $lt: cutoff } });
  return { messagesDeleted: messages.deletedCount, conversationsDeleted: conversations.deletedCount };
}
