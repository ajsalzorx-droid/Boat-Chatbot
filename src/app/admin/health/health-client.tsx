"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge, Button, Card, ErrorBanner, Notice, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/client/api";
import { formatDateTime, timeAgo } from "@/lib/client/format";
import { usePolling } from "@/lib/client/use-polling";
import type { ConfigGroupStatus } from "@/lib/config/env";
import type { HealthReport } from "@/services/health/health-service";

function ConfigRow({ label, status, note }: { label: string; status: ConfigGroupStatus; note?: string }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
      <span>{label}</span>
      {status.configured ? (
        <Badge tone="green">Configured{note ? ` · ${note}` : ""}</Badge>
      ) : (
        <Badge tone="red">
          {[status.missing.length > 0 ? `missing ${status.missing.join(", ")}` : "", status.invalid.length > 0 ? `invalid ${status.invalid.join(", ")}` : ""]
            .filter(Boolean)
            .join("; ")}
        </Badge>
      )}
    </li>
  );
}

export function HealthClient() {
  const { data, error, refresh } = usePolling<HealthReport>("/api/admin/health", 30_000);
  const [actionError, setActionError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function action(run: () => Promise<string>) {
    setBusy(true);
    setActionError(null);
    setResult(null);
    try {
      setResult(await run());
      await refresh();
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const testWhatsApp = () =>
    action(async () => {
      const response = await api<{ ok: boolean; displayPhoneNumber?: string | null; verifiedName?: string | null; qualityRating?: string | null; hint?: string }>(
        "/api/admin/health/whatsapp",
        { method: "POST" },
      );
      return response.ok
        ? `WhatsApp API OK: ${response.displayPhoneNumber ?? "?"} (${response.verifiedName ?? "no display name"}), quality ${response.qualityRating ?? "n/a"}.`
        : `WhatsApp API check failed: ${response.hint ?? "unknown error"}`;
    });

  const recover = () =>
    action(async () => {
      const report = await api<{ jobsRecovered: number; statusesReapplied: number; messagesDeleted: number }>("/api/admin/health/recovery", { method: "POST" });
      return `Recovery done: ${report.jobsRecovered} jobs re-run, ${report.statusesReapplied} statuses re-applied, ${report.messagesDeleted} expired messages deleted.`;
    });

  const retryJob = (id: string) => action(async () => {
    await api(`/api/admin/jobs/${id}/retry`, { method: "POST" });
    return "Job sent back to the queue.";
  });

  return (
    <div>
      <PageHeader
        title="System health"
        description="Configuration, webhook activity, queue and failures. No secrets are shown."
        actions={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => void testWhatsApp()}>
              Test WhatsApp connection
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void recover()}>
              Run recovery now
            </Button>
          </>
        }
      />
      <ErrorBanner message={error ?? actionError} />
      {result ? <Notice tone="blue">{result}</Notice> : null}
      {data?.warnings.map((warning) => <Notice key={warning}>{warning}</Notice>)}

      {data ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <h2 className="mb-2 font-semibold">Configuration</h2>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              <ConfigRow label="Database" status={data.config.database} note={data.database.ok ? `${data.database.latencyMs ?? "?"} ms` : "unreachable"} />
              <ConfigRow label="WhatsApp Cloud API" status={data.config.whatsapp} />
              <ConfigRow label="Admin sessions" status={data.config.auth} />
              <ConfigRow label="Queue" status={data.config.queue} note={data.queue.mode} />
              <ConfigRow label="Scheduled recovery (cron)" status={data.config.cron} />
              <li className="flex justify-between py-1.5 text-sm">
                <span>AI provider</span>
                {data.config.ai.enabled ? <Badge tone="green">Enabled</Badge> : <Badge>Off</Badge>}
              </li>
              <li className="flex justify-between py-1.5 text-sm">
                <span>Simulator</span>
                {data.config.simulatorEnabled ? <Badge tone="blue">Enabled</Badge> : <Badge>Disabled</Badge>}
              </li>
            </ul>
          </Card>

          <Card>
            <h2 className="mb-2 font-semibold">Webhook</h2>
            <ul className="space-y-1 text-sm">
              <li>
                Last event received: <strong>{data.webhook.lastReceivedAt ? `${timeAgo(data.webhook.lastReceivedAt)} (${formatDateTime(data.webhook.lastReceivedAt)})` : "never"}</strong>
              </li>
              <li>Events in the last 24h: {data.webhook.received24h}</li>
              <li>Failed events in the last 24h: {data.webhook.failed24h}</li>
              <li>Delivery statuses waiting for their message: {data.webhook.unmatchedStatuses}</li>
            </ul>
            <h3 className="mb-1 mt-4 text-sm font-semibold">Job queue</h3>
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(data.queue.counts).length === 0 ? <span className="text-slate-500">No jobs yet.</span> : null}
              {Object.entries(data.queue.counts).map(([status, count]) => (
                <Badge key={status} tone={status === "dead" || status === "failed" ? "red" : status === "done" ? "green" : "gray"}>
                  {status}: {count}
                </Badge>
              ))}
            </div>
          </Card>

          <Card>
            <h2 className="mb-2 font-semibold">Jobs needing attention</h2>
            {data.queue.problemJobs.length === 0 ? <p className="text-sm text-slate-500">None.</p> : null}
            <ul className="space-y-2 text-sm">
              {data.queue.problemJobs.map((job) => (
                <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                  <div>
                    <Badge tone={job.status === "retry_scheduled" ? "yellow" : "red"}>{job.status}</Badge>{" "}
                    <span className="text-xs text-slate-500">
                      attempt {job.attempts}/{job.maxAttempts} · {timeAgo(job.updatedAt)}
                    </span>
                    {job.lastError ? <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{job.lastError.code}: {job.lastError.message}</p> : null}
                    <Link className="text-xs text-brand-700 underline" href={`/admin/conversations/${job.conversationId}`}>
                      Open conversation
                    </Link>
                  </div>
                  {job.status !== "retry_scheduled" ? (
                    <Button variant="secondary" disabled={busy} onClick={() => void retryJob(job.id)}>
                      Retry
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <h2 className="mb-2 font-semibold">Failed outbound messages</h2>
            {data.failedMessages.length === 0 ? <p className="text-sm text-slate-500">None.</p> : null}
            <ul className="space-y-2 text-sm">
              {data.failedMessages.map((message) => (
                <li key={message.id} className="rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                  <Badge tone="red">{message.status}</Badge> <span className="text-xs text-slate-500">{timeAgo(message.createdAt)}</span>
                  <p className="mt-1 text-xs">
                    {message.code}: {message.title}
                  </p>
                  <Link className="text-xs text-brand-700 underline" href={`/admin/conversations/${message.conversationId}`}>
                    Open conversation to resend
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="xl:col-span-2">
            <h2 className="mb-2 font-semibold">Recent webhook events</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-1">Received</th>
                    <th className="py-1">Kind</th>
                    <th className="py-1">Field</th>
                    <th className="py-1">Result</th>
                    <th className="py-1">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentEvents.map((event, index) => (
                    <tr key={`${event.receivedAt}-${index}`} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="py-1">{formatDateTime(event.receivedAt)}</td>
                      <td className="py-1">{event.kind}</td>
                      <td className="py-1">{event.field}</td>
                      <td className="py-1">{event.status}</td>
                      <td className="py-1 text-slate-500">{event.note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
