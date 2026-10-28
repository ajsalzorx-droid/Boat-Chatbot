"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type SubmitEvent } from "react";

import { Button, Card, ErrorBanner, Field, Input, Notice, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/client/api";
import { timeAgo } from "@/lib/client/format";
import { usePolling } from "@/lib/client/use-polling";
import type { MessageDto } from "@/services/dto";

export function SimulatorClient() {
  const [customerId, setCustomerId] = useState("demo-1");
  const [customerName, setCustomerName] = useState("Test customer");
  const [text, setText] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const messages = usePolling<{ items: MessageDto[] }>(conversationId ? `/api/admin/conversations/${conversationId}/messages` : null, 5_000);
  const count = messages.data?.items.length ?? 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [count]);

  async function send(event: SubmitEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ conversationId: string }>("/api/admin/simulator/messages", {
        method: "POST",
        body: { customerId, customerName, text },
      });
      setText("");
      setConversationId(result.conversationId);
      await messages.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <PageHeader title="Simulator" description="Chat with the bot as a customer, using your real FAQs, products, settings and AI." />
      <Notice tone="blue">
        Simulated conversations go through the full bot pipeline but are <strong>never sent to WhatsApp</strong>. Replies are marked
        &quot;Simulated&quot;. Use a new customer ID to start a fresh conversation.
      </Notice>
      <ErrorBanner message={error ?? messages.error} />

      <Card className="mb-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Customer ID">
            <Input value={customerId} onChange={(event) => { setCustomerId(event.target.value); setConversationId(null); }} />
          </Field>
          <Field label="Customer name">
            <Input value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
          </Field>
        </div>
        {conversationId ? (
          <Link className="mt-2 inline-block text-xs text-brand-700 underline" href={`/admin/conversations/${conversationId}`}>
            Open in Conversations
          </Link>
        ) : null}
      </Card>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-xl bg-slate-100 p-3 dark:bg-slate-950">
        {!conversationId ? <p className="text-center text-sm text-slate-500">Send a message to start.</p> : null}
        {messages.data?.items.map((message) => (
          <div key={message.id} className={`flex ${message.direction === "inbound" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                message.direction === "inbound" ? "rounded-br-sm bg-emerald-100 dark:bg-emerald-900/50" : "rounded-bl-sm bg-white dark:bg-slate-800"
              }`}
            >
              {message.image ? (
                <figure className="space-y-1">
                  <img src={message.image.url} alt={message.image.caption} className="max-h-56 rounded-lg object-cover" loading="lazy" />
                  {message.image.caption ? <figcaption className="whitespace-pre-wrap break-words">{message.image.caption}</figcaption> : null}
                </figure>
              ) : (
                <p className="whitespace-pre-wrap break-words">{message.text ?? `[${message.type}]`}</p>
              )}
              <p className="mt-1 text-right text-[11px] text-slate-500">
                {message.direction === "outbound" ? `${message.sender}${message.botSource ? ` · ${message.botSource}` : ""} · ` : ""}
                {timeAgo(message.createdAt)}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={(event) => void send(event)} className="mt-3 flex gap-2">
        <Input placeholder="Type as the customer…" value={text} maxLength={4096} onChange={(event) => setText(event.target.value)} />
        <Button type="submit" disabled={busy || !text.trim()}>
          {busy ? "Bot is replying…" : "Send"}
        </Button>
      </form>
    </div>
  );
}
