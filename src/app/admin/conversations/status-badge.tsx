import { Badge } from "@/components/ui";

const STATUS: Record<string, { label: string; tone: "gray" | "green" | "yellow" | "blue" }> = {
  new: { label: "New", tone: "blue" },
  open: { label: "Open", tone: "green" },
  needs_human: { label: "Needs a person", tone: "yellow" },
  resolved: { label: "Resolved", tone: "gray" },
};

export function ConversationStatusBadge({ status }: { status: string }) {
  const entry = STATUS[status] ?? { label: status, tone: "gray" as const };
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}
