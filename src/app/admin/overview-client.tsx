"use client";

import Link from "next/link";

import { Card, ErrorBanner, Notice, PageHeader, Stat } from "@/components/ui";
import { usePolling } from "@/lib/client/use-polling";
import type { OverviewStats } from "@/services/health/health-service";

const SOURCE_LABELS: Record<string, string> = {
  faq: "FAQ answers",
  product: "Product answers",
  rules: "Rule-based",
  ai: "AI answers",
  fallback: "Fallback (no answer found)",
  policy: "Policy / opt-out",
};

export function OverviewClient({ denied }: { denied: boolean }) {
  const { data, error, loading } = usePolling<OverviewStats>("/api/admin/overview", 30_000);
  const maxDaily = Math.max(1, ...(data?.daily ?? []).map((day) => day.inbound + day.outbound));

  return (
    <div>
      <PageHeader title="Overview" description="WhatsApp activity at a glance. Simulator conversations are not counted." />
      {denied ? <Notice>You do not have access to that page.</Notice> : null}
      <ErrorBanner message={error} />
      {loading && !data ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <Stat label="Total conversations" value={data.totalConversations} />
            <Stat label="New enquiries" value={data.newEnquiries} />
            <Stat label="Active (24h)" value={data.activeConversations} />
            <Stat label="Unanswered" value={data.unanswered} tone={data.unanswered > 0 ? "yellow" : undefined} />
            <Stat label="Needs a person" value={data.needsHuman} tone={data.needsHuman > 0 ? "yellow" : undefined} />
            <Stat label="Failed sends (7d)" value={data.failedOutbound7d} tone={data.failedOutbound7d > 0 ? "red" : undefined} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="mb-3 text-sm font-semibold">Messages, last 7 days</h2>
              {data.daily.length === 0 ? (
                <p className="text-sm text-slate-500">No messages yet.</p>
              ) : (
                <ul className="space-y-2">
                  {data.daily.map((day) => (
                    <li key={day.date} className="text-xs">
                      <div className="mb-1 flex justify-between text-slate-600 dark:text-slate-400">
                        <span>{day.date}</span>
                        <span>
                          {day.inbound} in · {day.outbound} out
                        </span>
                      </div>
                      <div className="flex h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div className="bg-sky-500" style={{ width: `${(day.inbound / maxDaily) * 100}%` }} />
                        <div className="bg-brand-600" style={{ width: `${(day.outbound / maxDaily) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <h2 className="mb-3 text-sm font-semibold">Bot activity</h2>
              <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
                Last 24h: {data.messagesToday.inbound} customer messages, {data.messagesToday.bot} bot replies, {data.messagesToday.agent} staff replies.
              </p>
              <ul className="space-y-1 text-sm">
                {Object.entries(data.botSources7d).length === 0 ? <li className="text-slate-500">No bot replies in the last 7 days.</li> : null}
                {Object.entries(data.botSources7d).map(([source, count]) => (
                  <li key={source} className="flex justify-between">
                    <span>{SOURCE_LABELS[source] ?? source}</span>
                    <span className="font-medium">{count}</span>
                  </li>
                ))}
              </ul>
              {(data.botSources7d.fallback ?? 0) > 0 ? (
                <p className="mt-3 text-xs text-slate-500">
                  Fallback replies mean the bot had no answer. Add <Link className="text-brand-700 underline" href="/admin/faqs">FAQs</Link> to cover them.
                </p>
              ) : null}
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}
