"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type SubmitEvent } from "react";

import { Badge, Button, Card, ErrorBanner, Notice, Select, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/client/api";
import { formatDateTime, newRequestId, timeAgo } from "@/lib/client/format";
import { usePolling } from "@/lib/client/use-polling";
import type { AdminUserDto, ConversationDetailDto, MessageDto } from "@/services/dto";

import { ConversationStatusBadge } from "../status-badge";

const STATUS_LABEL: Record<MessageDto["status"], string> = {
  received: "",
  pending: "Queued",
  sending: "Sending…",
  accepted: "Sent to WhatsApp",
  sent: "Sent ✓",
  delivered: "Delivered ✓✓",
  read: "Read ✓✓",
  failed: "Failed",
  unknown: "Outcome unknown",
  simulated: "Simulated (not sent)",
};

const SENDER_LABEL: Record<MessageDto["sender"], string> = {
  customer: "Customer",
  bot: "Bot",
  agent: "Staff",
  system: "System",
  business_app: "Staff (WhatsApp app)",
};

interface SavedReplyDto {
  title: string;
  text: string;
}

function MessageBubble({ message, canRetry, onRetry }: { message: MessageDto; canRetry: boolean; onRetry: (message: MessageDto) => void }) {
  const inbound = message.direction === "inbound";
  return (
    <div className={`flex ${inbound ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-sm sm:max-w-[70%] ${
          inbound ? "rounded-bl-sm bg-white dark:bg-slate-800" : "rounded-br-sm bg-emerald-100 dark:bg-emerald-900/50"
        }`}
      >
        <div className="mb-0.5 flex items-center gap-2 text-[11px] text-slate-500">
          <span className="font-medium">{SENDER_LABEL[message.sender]}</span>
          {message.botSource ? <span>· {message.botSource}</span> : null}
        </div>
        {message.type === "template" ? (
          <p className="italic">Template: {message.templateName}</p>
        ) : message.image ? (
          <figure className="space-y-1">
            <img src={message.image.url} alt={message.image.caption} className="max-h-56 rounded-lg object-cover" loading="lazy" />
            {message.image.caption ? <figcaption className="whitespace-pre-wrap break-words">{message.image.caption}</figcaption> : null}
          </figure>
        ) : message.type === "unsupported" ? (
          <p className="italic text-slate-500">[{message.originalType} message — not shown]</p>
        ) : (
          <p className="whitespace-pre-wrap break-words">{message.text}</p>
        )}
        <div className="mt-1 flex flex-wrap items-center justify-end gap-2 text-[11px] text-slate-500">
          <span title={formatDateTime(message.createdAt)}>{timeAgo(message.createdAt)}</span>
          {!inbound ? <span className={message.status === "failed" || message.status === "unknown" ? "font-medium text-red-600" : ""}>{STATUS_LABEL[message.status]}</span> : null}
        </div>
        {message.error ? (
          <p className="mt-1 text-[11px] text-red-600">
            {message.error.code}: {message.error.title}
          </p>
        ) : null}
        {canRetry && (message.status === "failed" || message.status === "unknown") ? (
          <button type="button" className="mt-1 text-[11px] font-medium text-brand-700 underline" onClick={() => onRetry(message)}>
            Resend
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function ConversationDetailClient({ id, currentUserId, canDelete, canRetry }: { id: string; currentUserId: string; canDelete: boolean; canRetry: boolean }) {
  const conversation = usePolling<{ conversation: ConversationDetailDto }>(`/api/admin/conversations/${id}`, 10_000);
  const messages = usePolling<{ items: MessageDto[] }>(`/api/admin/conversations/${id}/messages`, 5_000);
  const users = usePolling<{ items: AdminUserDto[] }>("/api/admin/users", 300_000);
  const savedReplies = usePolling<{ items: SavedReplyDto[] }>("/api/admin/saved-replies", 300_000);

  const [text, setText] = useState("");
  const [requestId, setRequestId] = useState(newRequestId);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageCount = messages.data?.items.length ?? 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messageCount]);

  const detail = conversation.data?.conversation;
  const windowOpen = detail?.windowOpen ?? false;

  async function refreshAll() {
    await Promise.all([conversation.refresh(), messages.refresh()]);
  }

  async function update(body: Record<string, unknown>) {
    setActionError(null);
    try {
      await api(`/api/admin/conversations/${id}`, { method: "PATCH", body });
      await refreshAll();
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  async function send(event: SubmitEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setActionError(null);
    try {
      await api(`/api/admin/conversations/${id}/messages`, { method: "POST", body: { kind: "text", text, clientRequestId: requestId } });
      setText("");
      setRequestId(newRequestId());
      await refreshAll();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function sendTemplate() {
    setBusy(true);
    setActionError(null);
    try {
      await api(`/api/admin/conversations/${id}/messages`, { method: "POST", body: { kind: "template", clientRequestId: newRequestId() } });
      await refreshAll();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function retry(message: MessageDto) {
    const acceptDuplicateRisk =
      message.status === "unknown" &&
      window.confirm("WhatsApp may already have delivered this message. Resending could send it twice. Resend anyway?");
    if (message.status === "unknown" && !acceptDuplicateRisk) return;
    setActionError(null);
    try {
      await api(`/api/admin/messages/${message.id}/retry`, { method: "POST", body: { acceptDuplicateRisk } });
      await refreshAll();
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  async function erase() {
    if (!window.confirm("Permanently delete this customer's conversation and all messages? This cannot be undone.")) return;
    try {
      await api(`/api/admin/conversations/${id}`, { method: "DELETE" });
      window.location.href = "/admin/conversations";
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <div className="mb-3">
        <Link href="/admin/conversations" className="text-sm text-brand-700 hover:underline">
          ← Conversations
        </Link>
      </div>
      <ErrorBanner message={conversation.error ?? actionError} />

      {detail ? (
        <Card className="mb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold">{detail.customerName ?? "Unknown customer"}</h1>
                <ConversationStatusBadge status={detail.status} />
                {detail.channel === "simulator" ? <Badge tone="blue">Simulator</Badge> : null}
                {detail.optedOut ? <Badge tone="red">Opted out</Badge> : null}
              </div>
              <p className="text-sm text-slate-500">
                {detail.customerNumberFull ? `+${detail.customerNumberFull}` : "No phone number"} · since {formatDateTime(detail.createdAt)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => void update({ botEnabled: !detail.botEnabled })}>
                {detail.botEnabled ? "Pause bot" : "Resume bot"}
              </Button>
              {detail.status !== "needs_human" ? (
                <Button variant="secondary" onClick={() => void update({ status: "needs_human" })}>
                  Hand over to staff
                </Button>
              ) : null}
              {detail.status !== "resolved" ? (
                <Button variant="secondary" onClick={() => void update({ status: "resolved" })}>
                  Mark resolved
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => void update({ status: "open" })}>
                  Reopen
                </Button>
              )}
              <Select
                aria-label="Assigned to"
                className="w-44"
                value={detail.assignedAgentId ?? ""}
                onChange={(event) => void update({ assignedAgentId: event.target.value || null })}
              >
                <option value="">Unassigned</option>
                {(users.data?.items ?? []).map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.id === currentUserId ? `Me (${user.name})` : user.name}
                  </option>
                ))}
              </Select>
              {canDelete ? (
                <Button variant="ghost" className="text-red-600" onClick={() => void erase()}>
                  Delete data
                </Button>
              ) : null}
            </div>
          </div>
          {!detail.botEnabled ? (
            <p className="mt-2 text-xs text-violet-700 dark:text-violet-300">The bot is paused for this customer. Only staff replies are sent.</p>
          ) : detail.humanActiveUntil ? (
            <p className="mt-2 text-xs text-violet-700 dark:text-violet-300">
              Staff replied recently, so the bot stays quiet for this customer until {formatDateTime(detail.humanActiveUntil)}.
            </p>
          ) : null}
        </Card>
      ) : null}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-xl bg-slate-100 p-3 dark:bg-slate-950">
        {messages.data?.items.map((message) => <MessageBubble key={message.id} message={message} canRetry={canRetry} onRetry={(item) => void retry(item)} />)}
        {messages.data && messages.data.items.length === 0 ? <p className="text-center text-sm text-slate-500">No messages.</p> : null}
        <div ref={bottomRef} />
      </div>

      {detail && !detail.optedOut ? (
        windowOpen ? (
          <form onSubmit={(event) => void send(event)} className="mt-3 flex flex-wrap gap-2 sm:flex-nowrap">
            {(savedReplies.data?.items.length ?? 0) > 0 ? (
              <Select
                aria-label="Saved replies"
                className="w-full sm:w-40"
                value=""
                onChange={(event) => {
                  const reply = savedReplies.data?.items[Number(event.target.value)];
                  if (reply) setText((current) => (current.trim() ? `${current}\n${reply.text}` : reply.text));
                }}
              >
                <option value="">Saved replies…</option>
                {savedReplies.data?.items.map((reply, index) => (
                  <option key={`${reply.title}-${index}`} value={index}>
                    {reply.title}
                  </option>
                ))}
              </Select>
            ) : null}
            <Textarea
              className="min-h-12 flex-1"
              rows={2}
              placeholder="Type a reply… (sent through WhatsApp)"
              value={text}
              maxLength={4096}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <Button type="submit" disabled={busy || !text.trim()}>
              {busy ? "Sending…" : "Send"}
            </Button>
          </form>
        ) : (
          <div className="mt-3">
            <Notice>
              More than 24 hours have passed since the customer&apos;s last message, so WhatsApp only allows an approved template.
            </Notice>
            <Button variant="secondary" disabled={busy} onClick={() => void sendTemplate()}>
              Send re-engagement template
            </Button>
          </div>
        )
      ) : detail?.optedOut ? (
        <Notice tone="blue">This customer opted out. Messages can be sent again only after they message you and opt back in.</Notice>
      ) : null}
    </div>
  );
}
