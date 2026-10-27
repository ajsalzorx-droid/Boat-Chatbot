/**
 * WhatsApp Business messaging policy decisions, kept pure so they are explicit and testable.
 *
 * Rules implemented (confirm against Meta's current documentation before each release):
 * - Free-form messages may only be sent within the customer service window: 24 hours after the
 *   customer's most recent message.
 * - Outside the window, only an approved message template may be sent.
 * - Nothing is sent to a customer who has opted out, except the one opt-out confirmation.
 * - The platform never starts a conversation on its own: the bot only replies to inbound messages.
 */

export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Small safety margin so a message is never sent at the very edge of the window. */
const WINDOW_SAFETY_MARGIN_MS = 60 * 1000;

export interface WindowState {
  open: boolean;
  /** When the window closes (null when no customer message was ever received). */
  closesAt: Date | null;
}

export function customerServiceWindow(lastInboundAt: Date | null, now: Date = new Date()): WindowState {
  if (!lastInboundAt) return { open: false, closesAt: null };
  const closesAt = new Date(lastInboundAt.getTime() + CUSTOMER_SERVICE_WINDOW_MS);
  return { open: now.getTime() < closesAt.getTime() - WINDOW_SAFETY_MARGIN_MS, closesAt };
}

export type OutboundKind = "freeform" | "template" | "opt_out_confirmation";

export type PolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: "opted_out" | "window_closed_template_required" | "no_customer_contact" | "template_not_configured" | "template_not_approved" };

export interface PolicyInput {
  kind: OutboundKind;
  lastInboundAt: Date | null;
  optedOut: boolean;
  now?: Date;
  /** For templates: the approval status reported by Meta, or null when not configured. */
  templateStatus?: string | null;
}

export function evaluateOutboundPolicy(input: PolicyInput): PolicyDecision {
  const now = input.now ?? new Date();

  if (input.kind === "opt_out_confirmation") {
    return customerServiceWindow(input.lastInboundAt, now).open
      ? { allowed: true }
      : { allowed: false, reason: "window_closed_template_required" };
  }

  if (input.optedOut) return { allowed: false, reason: "opted_out" };
  if (!input.lastInboundAt) return { allowed: false, reason: "no_customer_contact" };

  if (input.kind === "freeform") {
    return customerServiceWindow(input.lastInboundAt, now).open
      ? { allowed: true }
      : { allowed: false, reason: "window_closed_template_required" };
  }

  if (input.templateStatus === undefined || input.templateStatus === null) {
    return { allowed: false, reason: "template_not_configured" };
  }
  if (input.templateStatus !== "APPROVED") return { allowed: false, reason: "template_not_approved" };
  return { allowed: true };
}

/** Clamps Meta's message timestamp so a skewed clock can never extend the window into the future. */
export function trustedInboundTime(customerSentAt: Date, receivedAt: Date): Date {
  return customerSentAt.getTime() > receivedAt.getTime() ? receivedAt : customerSentAt;
}

export function describePolicyReason(reason: Exclude<PolicyDecision, { allowed: true }>["reason"]): string {
  switch (reason) {
    case "opted_out":
      return "The customer has opted out of messages.";
    case "window_closed_template_required":
      return "More than 24 hours since the customer's last message. Only an approved template can be sent.";
    case "no_customer_contact":
      return "The customer has never messaged this number.";
    case "template_not_configured":
      return "No re-engagement template is configured in Settings.";
    case "template_not_approved":
      return "The configured template is not approved by Meta.";
  }
}
