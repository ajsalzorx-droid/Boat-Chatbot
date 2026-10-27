"use client";

import { useEffect, useState, type SubmitEvent, type ReactNode } from "react";

import { Button, Card, Checkbox, ErrorBanner, Field, Input, Notice, PageHeader, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/client/api";
import type { SettingsDto } from "@/services/dto";

type Settings = Omit<SettingsDto, "updatedAt">;
type MessageKey = keyof Settings["messages"];

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const MESSAGE_LABELS: Record<MessageKey, { label: string; hint: string }> = {
  greeting: { label: "Greeting", hint: "{name} is replaced with the customer's first name" },
  fallback: { label: "Fallback", hint: "When the bot has no answer" },
  handoff: { label: "Handoff", hint: "When a staff member takes over" },
  outOfHours: { label: "Out of hours", hint: "Added to the fallback outside opening hours" },
  optOut: { label: "Opt-out confirmation", hint: "Sent once when a customer unsubscribes" },
  optIn: { label: "Opt-in confirmation", hint: "Sent when a customer subscribes again" },
};

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <h2 className="font-semibold">{title}</h2>
      {description ? <p className="mb-3 text-sm text-slate-500">{description}</p> : <div className="mb-3" />}
      <div className="space-y-3">{children}</div>
    </Card>
  );
}

function splitList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function SettingsClient() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<{ settings: SettingsDto }>("/api/admin/settings")
      .then(({ settings: loaded }) => {
        if (cancelled) return;
        const { updatedAt: _updatedAt, ...rest } = loaded;
        // Make sure every day of the week has a row.
        const hours = DAYS.map((_, day) => rest.businessHours.find((entry) => entry.day === day) ?? { day, closed: true, open: "09:00", close: "18:00" });
        setSettings({ ...rest, businessHours: hours });
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(errorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!settings) {
    return (
      <div>
        <PageHeader title="Settings" />
        <ErrorBanner message={error} />
        {!error ? <p className="text-sm text-slate-500">Loading…</p> : null}
      </div>
    );
  }

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings({ ...settings, [key]: value });

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!settings) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const body = {
        ...settings,
        messages: Object.fromEntries(
          Object.entries(settings.messages).map(([key, value]) => [key, { en: value.en, ...(value.ar ? { ar: value.ar } : {}) }]),
        ),
      };
      await api("/api/admin/settings", { method: "PUT", body });
      setSaved(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const template = settings.messaging.reengagementTemplate;

  return (
    <form onSubmit={(event) => void save(event)}>
      <PageHeader
        title="Settings"
        description="Company information and chatbot behaviour. The bot only uses what is saved here, in FAQs and in Products."
        actions={
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save settings"}
          </Button>
        }
      />
      <ErrorBanner message={error} />
      {saved ? <Notice tone="green">Settings saved.</Notice> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Company">
          <Field label="Company name">
            <Input value={settings.companyName} maxLength={120} onChange={(event) => set("companyName", event.target.value)} />
          </Field>
          <Field label="Description" hint="Short description the bot can share">
            <Textarea value={settings.description} maxLength={2000} onChange={(event) => set("description", event.target.value)} />
          </Field>
          <Field label="Logo URL">
            <Input type="url" value={settings.logoUrl} onChange={(event) => set("logoUrl", event.target.value)} />
          </Field>
          <Field label="Business WhatsApp number" hint="With country code, e.g. +9715XXXXXXXX">
            <Input value={settings.businessWhatsAppNumber} onChange={(event) => set("businessWhatsAppNumber", event.target.value)} />
          </Field>
          <Field label="Instagram profile URL">
            <Input type="url" value={settings.instagramUrl} onChange={(event) => set("instagramUrl", event.target.value)} />
          </Field>
          <Field label="Website URL">
            <Input type="url" value={settings.websiteUrl} onChange={(event) => set("websiteUrl", event.target.value)} />
          </Field>
          <Field label="Address">
            <Textarea className="min-h-16" value={settings.address} maxLength={500} onChange={(event) => set("address", event.target.value)} />
          </Field>
          <Field label="Google Maps link">
            <Input type="url" value={settings.mapsUrl} onChange={(event) => set("mapsUrl", event.target.value)} />
          </Field>
        </Section>

        <Section title="Opening hours" description="Used to answer 'are you open?' and for out-of-hours replies.">
          <Field label="Timezone" hint="IANA name, e.g. Asia/Dubai">
            <Input value={settings.timezone} onChange={(event) => set("timezone", event.target.value)} />
          </Field>
          {settings.businessHours.map((entry, index) => (
            <div key={entry.day} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-24 font-medium">{DAYS[entry.day]}</span>
              <Checkbox
                label="Closed"
                checked={entry.closed}
                onChange={(closed) => set("businessHours", settings.businessHours.map((item, i) => (i === index ? { ...item, closed } : item)))}
              />
              {!entry.closed ? (
                <>
                  <Input
                    type="time"
                    className="w-28"
                    value={entry.open}
                    onChange={(event) => set("businessHours", settings.businessHours.map((item, i) => (i === index ? { ...item, open: event.target.value } : item)))}
                  />
                  <span>to</span>
                  <Input
                    type="time"
                    className="w-28"
                    value={entry.close}
                    onChange={(event) => set("businessHours", settings.businessHours.map((item, i) => (i === index ? { ...item, close: event.target.value } : item)))}
                  />
                </>
              ) : null}
            </div>
          ))}
          <Field label="Closed dates" hint="Comma separated YYYY-MM-DD, e.g. public holidays">
            <Input
              value={settings.specialClosures.map((closure) => closure.date).join(", ")}
              onChange={(event) => set("specialClosures", splitList(event.target.value).map((date) => ({ date, note: "" })))}
            />
          </Field>
        </Section>

        <Section title="Chatbot" description="Customer messages are untrusted; these instructions cannot be overridden by them.">
          <Checkbox label="Bot enabled (when off, nobody gets automatic replies)" checked={settings.botEnabled} onChange={(value) => set("botEnabled", value)} />
          <Checkbox label="Use AI for questions not covered by FAQs (if configured on the server)" checked={settings.ai.enabled} onChange={(enabled) => set("ai", { ...settings.ai, enabled })} />
          <Field label="Bot instructions" hint="Tone and style, e.g. 'Friendly and short. Offer the website for full catalogue.'">
            <Textarea value={settings.botInstructions} maxLength={4000} onChange={(event) => set("botInstructions", event.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Maximum reply length (characters)">
              <Input type="number" min={100} max={4096} value={settings.maxResponseLength} onChange={(event) => set("maxResponseLength", Number(event.target.value))} />
            </Field>
            <Field label="Conversation history sent to AI (messages)">
              <Input type="number" min={0} max={30} value={settings.ai.maxHistoryMessages} onChange={(event) => set("ai", { ...settings.ai, maxHistoryMessages: Number(event.target.value) })} />
            </Field>
          </div>
        </Section>

        <Section
          title="Staff first (WhatsApp Business app on the same number)"
          description="For numbers shared with the WhatsApp Business app. The bot waits a little before answering, and stays quiet when staff replied from the app or the dashboard."
        >
          <Checkbox
            label="Let staff answer first"
            checked={settings.humanFirst.enabled}
            onChange={(enabled) => set("humanFirst", { ...settings.humanFirst, enabled })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bot waits (seconds)" hint="0 to 120. If staff replies within this time, the bot does not answer.">
              <Input
                type="number"
                min={0}
                max={120}
                value={settings.humanFirst.waitSeconds}
                onChange={(event) => set("humanFirst", { ...settings.humanFirst, waitSeconds: Number(event.target.value) })}
              />
            </Field>
            <Field label="Bot pauses after a staff reply (minutes)" hint="0 to 1440. The bot stays quiet for that customer meanwhile.">
              <Input
                type="number"
                min={0}
                max={1440}
                value={settings.humanFirst.pauseMinutes}
                onChange={(event) => set("humanFirst", { ...settings.humanFirst, pauseMinutes: Number(event.target.value) })}
              />
            </Field>
          </div>
        </Section>

        <Section title="Saved replies" description="Ready-made texts staff can insert when replying from a conversation.">
          {settings.savedReplies.map((reply, index) => (
            <div key={index} className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div className="flex gap-2">
                <Input
                  aria-label="Title"
                  placeholder="Title, e.g. Opening hours"
                  required
                  maxLength={60}
                  value={reply.title}
                  onChange={(event) => set("savedReplies", settings.savedReplies.map((item, i) => (i === index ? { ...item, title: event.target.value } : item)))}
                />
                <Button
                  variant="ghost"
                  className="text-red-600"
                  onClick={() => set("savedReplies", settings.savedReplies.filter((_, i) => i !== index))}
                >
                  Remove
                </Button>
              </div>
              <Textarea
                aria-label="Reply text"
                className="min-h-16"
                required
                maxLength={4096}
                value={reply.text}
                onChange={(event) => set("savedReplies", settings.savedReplies.map((item, i) => (i === index ? { ...item, text: event.target.value } : item)))}
              />
            </div>
          ))}
          {settings.savedReplies.length < 50 ? (
            <Button variant="secondary" onClick={() => set("savedReplies", [...settings.savedReplies, { title: "", text: "" }])}>
              Add saved reply
            </Button>
          ) : null}
        </Section>

        <Section title="Human support" description="Shared when customers ask how to reach the team.">
          <Field label="Phone">
            <Input value={settings.humanSupport.phone} onChange={(event) => set("humanSupport", { ...settings.humanSupport, phone: event.target.value })} />
          </Field>
          <Field label="Email">
            <Input type="email" value={settings.humanSupport.email} onChange={(event) => set("humanSupport", { ...settings.humanSupport, email: event.target.value })} />
          </Field>
          <Field label="Availability note" hint="e.g. 'Staff reply within 1 hour during opening hours'">
            <Input value={settings.humanSupport.hoursNote} onChange={(event) => set("humanSupport", { ...settings.humanSupport, hoursNote: event.target.value })} />
          </Field>
        </Section>

        <Section title="Automatic messages" description="English is required; Arabic is used when the customer writes in Arabic.">
          {(Object.keys(MESSAGE_LABELS) as MessageKey[]).map((key) => (
            <div key={key} className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <p className="text-sm font-medium">{MESSAGE_LABELS[key].label}</p>
              <p className="text-xs text-slate-500">{MESSAGE_LABELS[key].hint}</p>
              <Textarea
                className="min-h-16"
                required
                value={settings.messages[key].en}
                onChange={(event) => set("messages", { ...settings.messages, [key]: { ...settings.messages[key], en: event.target.value } })}
              />
              <Textarea
                dir="rtl"
                className="min-h-16"
                placeholder="العربية (اختياري)"
                value={settings.messages[key].ar ?? ""}
                onChange={(event) => set("messages", { ...settings.messages, [key]: { ...settings.messages[key], ar: event.target.value } })}
              />
            </div>
          ))}
        </Section>

        <Section title="WhatsApp messaging rules" description="Outside the 24-hour customer service window only an approved template can be sent.">
          <Checkbox
            label="Re-engagement template configured"
            checked={template !== null}
            onChange={(on) => set("messaging", { ...settings.messaging, reengagementTemplate: on ? { name: "", languageCode: "en" } : null })}
          />
          {template ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Template name" hint="Exactly as approved in WhatsApp Manager">
                <Input value={template.name} onChange={(event) => set("messaging", { ...settings.messaging, reengagementTemplate: { ...template, name: event.target.value } })} />
              </Field>
              <Field label="Language code" hint="e.g. en, en_US, ar">
                <Input value={template.languageCode} onChange={(event) => set("messaging", { ...settings.messaging, reengagementTemplate: { ...template, languageCode: event.target.value } })} />
              </Field>
            </div>
          ) : null}
          <Field label="Opt-out keywords" hint="A message containing only one of these unsubscribes the customer">
            <Input value={settings.messaging.optOutKeywords.join(", ")} onChange={(event) => set("messaging", { ...settings.messaging, optOutKeywords: splitList(event.target.value) })} />
          </Field>
          <Field label="Opt-in keywords">
            <Input value={settings.messaging.optInKeywords.join(", ")} onChange={(event) => set("messaging", { ...settings.messaging, optInKeywords: splitList(event.target.value) })} />
          </Field>
        </Section>

        <Section title="Data retention" description="Messages older than this are deleted automatically by the scheduled recovery job.">
          <Field label="Keep messages for (days)" hint="30 to 3650">
            <Input type="number" min={30} max={3650} value={settings.retention.messageRetentionDays} onChange={(event) => set("retention", { messageRetentionDays: Number(event.target.value) })} />
          </Field>
        </Section>
      </div>
    </form>
  );
}
