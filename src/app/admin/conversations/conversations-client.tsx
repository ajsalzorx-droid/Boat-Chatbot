"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge, Button, Card, EmptyState, ErrorBanner, Input, PageHeader, Select } from "@/components/ui";
import { timeAgo } from "@/lib/client/format";
import { usePolling } from "@/lib/client/use-polling";
import type { ConversationSummaryDto } from "@/services/dto";

import { ConversationStatusBadge } from "./status-badge";

interface ListResponse {
  items: ConversationSummaryDto[];
  total: number;
  page: number;
  pageSize: number;
}

export function ConversationsClient() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("whatsapp");
  const [assigned, setAssigned] = useState("");
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page), pageSize: "30" });
  if (search.trim()) params.set("search", search.trim());
  if (status) params.set("status", status);
  if (channel) params.set("channel", channel);
  if (assigned) params.set("assigned", assigned);

  const { data, error, loading } = usePolling<ListResponse>(`/api/admin/conversations?${params.toString()}`, 10_000);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <PageHeader title="Conversations" description="Refreshes every 10 seconds." />
      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input placeholder="Search name, number or message" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
          <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} aria-label="Status">
            <option value="">All statuses</option>
            <option value="unanswered">Unanswered</option>
            <option value="new">New</option>
            <option value="open">Open</option>
            <option value="needs_human">Needs a person</option>
            <option value="resolved">Resolved</option>
          </Select>
          <Select value={assigned} onChange={(event) => { setAssigned(event.target.value); setPage(1); }} aria-label="Assignment">
            <option value="">Anyone</option>
            <option value="me">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
          </Select>
          <Select value={channel} onChange={(event) => { setChannel(event.target.value); setPage(1); }} aria-label="Channel">
            <option value="whatsapp">WhatsApp</option>
            <option value="simulator">Simulator</option>
            <option value="">All channels</option>
          </Select>
        </div>
      </Card>

      <ErrorBanner message={error} />
      {loading && !data ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {data && data.items.length === 0 ? <EmptyState title="No conversations found">Customer messages appear here as soon as they arrive.</EmptyState> : null}

      {data && data.items.length > 0 ? (
        <Card className="divide-y divide-slate-100 p-0 dark:divide-slate-800">
          {data.items.map((conversation) => (
            <Link
              key={conversation.id}
              href={`/admin/conversations/${conversation.id}`}
              className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                {(conversation.customerName ?? "?").slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{conversation.customerName ?? "Unknown customer"}</span>
                  <span className="text-xs text-slate-500">{conversation.customerNumber}</span>
                  <ConversationStatusBadge status={conversation.status} />
                  {conversation.unanswered ? <Badge tone="yellow">Unanswered</Badge> : null}
                  {!conversation.botEnabled ? <Badge tone="purple">Bot paused</Badge> : null}
                  {conversation.optedOut ? <Badge tone="red">Opted out</Badge> : null}
                  {conversation.channel === "simulator" ? <Badge tone="blue">Simulator</Badge> : null}
                </div>
                <p className="mt-0.5 truncate text-sm text-slate-600 dark:text-slate-400">
                  {conversation.lastMessageDirection === "outbound" ? "You: " : ""}
                  {conversation.lastMessagePreview}
                </p>
              </div>
              <span className="shrink-0 text-xs text-slate-500">{timeAgo(conversation.lastMessageAt)}</span>
            </Link>
          ))}
        </Card>
      ) : null}

      {data && pages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
            Previous
          </Button>
          <span className="text-slate-500">
            Page {page} of {pages} · {data.total} total
          </span>
          <Button variant="secondary" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
