"use client";

import { useState, type SubmitEvent } from "react";

import { Badge, Button, Card, Checkbox, EmptyState, ErrorBanner, Field, Input, PageHeader, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/client/api";
import { usePolling } from "@/lib/client/use-polling";
import type { FaqDto } from "@/services/dto";

interface Draft {
  id: string | null;
  question: string;
  answer: string;
  keywords: string;
  active: boolean;
}

const EMPTY: Draft = { id: null, question: "", answer: "", keywords: "", active: true };

export function FaqsClient() {
  const { data, error, refresh } = usePolling<{ items: FaqDto[] }>("/api/admin/faqs", 60_000);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!draft) return;
    setActionError(null);
    const body = {
      question: draft.question,
      answer: draft.answer,
      keywords: draft.keywords.split(",").map((keyword) => keyword.trim()).filter(Boolean),
      active: draft.active,
    };
    try {
      await api(draft.id ? `/api/admin/faqs/${draft.id}` : "/api/admin/faqs", { method: draft.id ? "PATCH" : "POST", body });
      setDraft(null);
      await refresh();
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  }

  async function toggle(faq: FaqDto) {
    try {
      await api(`/api/admin/faqs/${faq.id}`, { method: "PATCH", body: { active: !faq.active } });
      await refresh();
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  }

  async function remove(faq: FaqDto) {
    if (!window.confirm(`Delete the FAQ "${faq.question}"?`)) return;
    try {
      await api(`/api/admin/faqs/${faq.id}`, { method: "DELETE" });
      await refresh();
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  }

  const items = (data?.items ?? []).filter((faq) => `${faq.question} ${faq.answer} ${faq.keywords.join(" ")}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div>
      <PageHeader
        title="FAQs"
        description="Approved answers the bot gives word for word. Keywords help it recognise different phrasings (add Arabic terms too)."
        actions={<Button onClick={() => setDraft(EMPTY)}>Add FAQ</Button>}
      />
      <ErrorBanner message={error ?? actionError} />

      {draft ? (
        <Card className="mb-4">
          <form onSubmit={(event) => void save(event)} className="space-y-3">
            <Field label="Question">
              <Input required minLength={3} maxLength={300} value={draft.question} onChange={(event) => setDraft({ ...draft, question: event.target.value })} />
            </Field>
            <Field label="Answer">
              <Textarea required maxLength={2000} value={draft.answer} onChange={(event) => setDraft({ ...draft, answer: event.target.value })} />
            </Field>
            <Field label="Keywords" hint="Comma separated, e.g. delivery, shipping, توصيل">
              <Input value={draft.keywords} onChange={(event) => setDraft({ ...draft, keywords: event.target.value })} />
            </Field>
            <Checkbox label="Active (used by the bot)" checked={draft.active} onChange={(active) => setDraft({ ...draft, active })} />
            <div className="flex gap-2">
              <Button type="submit">{draft.id ? "Save changes" : "Create FAQ"}</Button>
              <Button variant="secondary" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Input className="mb-3 max-w-sm" placeholder="Filter FAQs" value={filter} onChange={(event) => setFilter(event.target.value)} />

      {data && items.length === 0 ? <EmptyState title="No FAQs yet">Add the questions customers ask most often.</EmptyState> : null}
      <div className="space-y-3">
        {items.map((faq) => (
          <Card key={faq.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{faq.question}</p>
                  {faq.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-400">{faq.answer}</p>
                {faq.keywords.length > 0 ? <p className="mt-1 text-xs text-slate-500">Keywords: {faq.keywords.join(", ")}</p> : null}
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" onClick={() => setDraft({ id: faq.id, question: faq.question, answer: faq.answer, keywords: faq.keywords.join(", "), active: faq.active })}>
                  Edit
                </Button>
                <Button variant="ghost" onClick={() => void toggle(faq)}>
                  {faq.active ? "Deactivate" : "Activate"}
                </Button>
                <Button variant="ghost" className="text-red-600" onClick={() => void remove(faq)}>
                  Delete
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
