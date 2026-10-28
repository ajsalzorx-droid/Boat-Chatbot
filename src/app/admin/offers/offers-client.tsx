"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/client/api";
import { formatDateTime } from "@/lib/client/format";
import { usePolling } from "@/lib/client/use-polling";

interface Broadcast {
  id: string;
  title: string;
  percent: number;
  bannerUrl: string | null;
  validUntil: string;
  status: "waiting" | "sent" | "skipped";
  note: string | null;
  recipients: number;
  sentAt: string | null;
  delivery: Record<string, number>;
}

interface OffersData {
  enabled: boolean;
  template: { name: string; languageCode: string } | null;
  websiteConnected: boolean;
  subscribers: number;
  broadcasts: Broadcast[];
}

interface RunReport {
  offersFound: number;
  announced: number;
  waiting: number;
  messagesQueued: number;
}

const STATUS_TONE = { waiting: "yellow", sent: "green", skipped: "gray" } as const;

function deliverySummary(delivery: Record<string, number>): string {
  const count = (...statuses: string[]) => statuses.reduce((total, status) => total + (delivery[status] ?? 0), 0);
  const parts = [
    [count("accepted", "sent", "simulated"), "sent"],
    [count("delivered"), "delivered"],
    [count("read"), "read"],
    [count("pending", "sending"), "sending"],
    [count("failed", "unknown"), "failed"],
  ] as const;
  return parts.filter(([value]) => value > 0).map(([value, label]) => `${value} ${label}`).join(" · ") || "-";
}

export function OffersClient() {
  const { data, error, refresh } = usePolling<OffersData>("/api/admin/offers", 30_000);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function checkNow() {
    setChecking(true);
    setActionError(null);
    setNotice(null);
    try {
      const { report } = await api<{ report: RunReport | null }>("/api/admin/offers", { method: "POST" });
      setNotice(
        report
          ? `${report.offersFound} running offer(s) on the website: ${report.announced} newly announced, ${report.messagesQueued} message(s) queued${report.waiting ? `, ${report.waiting} waiting` : ""}.`
          : "Nothing checked: offer alerts are off, or the website database is not connected.",
      );
      await refresh();
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Offer alerts"
        description="When a new offer goes live on the website, customers who replied OFFERS ON get its banner on WhatsApp. Checked every 5 minutes."
        actions={
          <Button onClick={() => void checkNow()} disabled={checking}>
            {checking ? "Checking…" : "Check for new offers now"}
          </Button>
        }
      />
      <ErrorBanner message={error ?? actionError} />
      {notice ? <Card className="mb-4 text-sm">{notice}</Card> : null}

      {data ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Card>
            <p className="text-xs uppercase text-slate-500">Status</p>
            <div className="mt-1">{data.enabled ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}</div>
            {!data.enabled ? (
              <p className="mt-1 text-xs text-slate-500">
                Turn on under{" "}
                <Link className="underline" href="/admin/settings">
                  Settings → Offer alerts
                </Link>
                .
              </p>
            ) : null}
          </Card>
          <Card>
            <p className="text-xs uppercase text-slate-500">Subscribers</p>
            <p className="mt-1 text-2xl font-semibold">{data.subscribers}</p>
            <p className="text-xs text-slate-500">Customers who replied OFFERS ON</p>
          </Card>
          <Card>
            <p className="text-xs uppercase text-slate-500">Template</p>
            <p className="mt-1 font-semibold">{data.template ? `${data.template.name} (${data.template.languageCode})` : "Not set"}</p>
            {!data.websiteConnected ? <p className="mt-1 text-xs text-red-600">Website database not connected (WEBSITE_DB_URI).</p> : null}
          </Card>
        </div>
      ) : null}

      {data && data.broadcasts.length === 0 ? <EmptyState title="No offers announced yet" /> : null}
      {data && data.broadcasts.length > 0 ? (
        <div className="space-y-3">
          {data.broadcasts.map((broadcast) => (
            <Card key={broadcast.id} className="flex flex-wrap gap-4">
              {broadcast.bannerUrl ? <img src={broadcast.bannerUrl} alt="" className="h-24 w-40 rounded-lg object-cover" loading="lazy" /> : null}
              <div className="min-w-0 flex-1 space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{broadcast.title}</span>
                  <span>
                    {broadcast.percent}% off, until {broadcast.validUntil}
                  </span>
                  <Badge tone={STATUS_TONE[broadcast.status]}>{broadcast.status}</Badge>
                </div>
                {broadcast.note ? <p className="text-amber-700 dark:text-amber-400">{broadcast.note}</p> : null}
                {broadcast.sentAt ? (
                  <p className="text-slate-500">
                    Sent {formatDateTime(broadcast.sentAt)} to {broadcast.recipients} subscriber(s): {deliverySummary(broadcast.delivery)}
                  </p>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
