import { describe, expect, it } from "vitest";

import { CUSTOMER_SERVICE_WINDOW_MS, customerServiceWindow, evaluateOutboundPolicy, trustedInboundTime } from "@/lib/whatsapp/policy";

const now = new Date("2026-10-14T12:00:00Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

describe("customerServiceWindow", () => {
  it("is open within 24 hours of the last customer message", () => {
    expect(customerServiceWindow(hoursAgo(1), now)).toEqual({ open: true, closesAt: new Date(hoursAgo(1).getTime() + CUSTOMER_SERVICE_WINDOW_MS) });
    expect(customerServiceWindow(hoursAgo(23.9), now).open).toBe(true);
  });

  it("closes after 24 hours, with a one-minute safety margin", () => {
    expect(customerServiceWindow(hoursAgo(24), now).open).toBe(false);
    expect(customerServiceWindow(new Date(now.getTime() - CUSTOMER_SERVICE_WINDOW_MS + 30_000), now).open).toBe(false);
    expect(customerServiceWindow(null, now)).toEqual({ open: false, closesAt: null });
  });
});

describe("evaluateOutboundPolicy", () => {
  it("allows free-form replies inside the window", () => {
    expect(evaluateOutboundPolicy({ kind: "freeform", lastInboundAt: hoursAgo(2), optedOut: false, now })).toEqual({ allowed: true });
  });

  it("requires a template outside the window", () => {
    expect(evaluateOutboundPolicy({ kind: "freeform", lastInboundAt: hoursAgo(30), optedOut: false, now })).toEqual({
      allowed: false,
      reason: "window_closed_template_required",
    });
  });

  it("never messages opted-out customers or customers who never wrote", () => {
    expect(evaluateOutboundPolicy({ kind: "freeform", lastInboundAt: hoursAgo(1), optedOut: true, now })).toMatchObject({ reason: "opted_out" });
    expect(evaluateOutboundPolicy({ kind: "template", lastInboundAt: hoursAgo(1), optedOut: true, now, templateStatus: "APPROVED" })).toMatchObject({ reason: "opted_out" });
    expect(evaluateOutboundPolicy({ kind: "freeform", lastInboundAt: null, optedOut: false, now })).toMatchObject({ reason: "no_customer_contact" });
  });

  it("only allows templates that are configured and approved", () => {
    const base = { kind: "template" as const, lastInboundAt: hoursAgo(48), optedOut: false, now };
    expect(evaluateOutboundPolicy({ ...base, templateStatus: null })).toMatchObject({ reason: "template_not_configured" });
    expect(evaluateOutboundPolicy({ ...base, templateStatus: "PENDING" })).toMatchObject({ reason: "template_not_approved" });
    expect(evaluateOutboundPolicy({ ...base, templateStatus: "REJECTED" })).toMatchObject({ reason: "template_not_approved" });
    expect(evaluateOutboundPolicy({ ...base, templateStatus: "APPROVED" })).toEqual({ allowed: true });
  });

  it("sends an opt-out confirmation only while the window is open", () => {
    expect(evaluateOutboundPolicy({ kind: "opt_out_confirmation", lastInboundAt: hoursAgo(1), optedOut: true, now })).toEqual({ allowed: true });
    expect(evaluateOutboundPolicy({ kind: "opt_out_confirmation", lastInboundAt: hoursAgo(25), optedOut: true, now }).allowed).toBe(false);
  });
});

describe("trustedInboundTime", () => {
  it("never lets a future customer timestamp extend the window", () => {
    const received = new Date("2026-10-14T12:00:00Z");
    expect(trustedInboundTime(new Date("2026-10-14T13:00:00Z"), received)).toEqual(received);
    expect(trustedInboundTime(new Date("2026-10-14T11:59:00Z"), received)).toEqual(new Date("2026-10-14T11:59:00Z"));
  });
});
