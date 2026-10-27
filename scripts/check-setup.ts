/**
 * Read-only setup check: validates configuration, pings MongoDB and asks the Graph API whether the
 * WhatsApp credentials work. Sends no messages and prints no secret values.
 *
 * Usage: npm run check:setup
 */
import mongoose from "mongoose";

import { getConfigStatus, getWhatsAppConfig, type ConfigGroupStatus } from "@/lib/config/env";
import { pingDatabase } from "@/lib/db/mongoose";

type Outcome = "ok" | "fail" | "skip";

const ICON: Record<Outcome, string> = { ok: "✅", fail: "❌", skip: "⏭️ " };

function report(outcome: Outcome, label: string, detail = ""): void {
  console.log(`${ICON[outcome]} ${label}${detail ? ` — ${detail}` : ""}`);
}

function describeGroup(status: ConfigGroupStatus): string {
  if (status.configured) return "";
  return [
    status.missing.length > 0 ? `missing: ${status.missing.join(", ")}` : "",
    status.invalid.length > 0 ? `invalid: ${status.invalid.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

interface GraphPhoneNumber {
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  code_verification_status?: string;
}

interface GraphError {
  error?: { message?: string; code?: number; error_subcode?: number; type?: string };
}

async function checkWhatsApp(): Promise<void> {
  const config = getWhatsAppConfig();
  const url = new URL(`${config.graphApiBaseUrl}/${config.phoneNumberId}`);
  url.searchParams.set("fields", "display_phone_number,verified_name,quality_rating,code_verification_status");

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${config.accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    report("fail", "WhatsApp API", "could not reach graph.facebook.com (network or timeout)");
    return;
  }

  const body = (await response.json().catch(() => ({}))) as GraphPhoneNumber & GraphError;
  if (!response.ok) {
    const code = body.error?.code;
    const hint =
      code === 190
        ? "access token expired or invalid; generate a new one in the Meta app (API Setup / Try it out)"
        : code === 100
          ? "phone number ID not found or token lacks permission"
          : (body.error?.message ?? `HTTP ${response.status}`);
    report("fail", "WhatsApp API", `error ${code ?? response.status}: ${hint}`);
    return;
  }

  report(
    "ok",
    "WhatsApp API",
    `number ${body.display_phone_number ?? "?"} (${body.verified_name ?? "no display name"}), quality ${body.quality_rating ?? "n/a"}`,
  );
}

async function main(): Promise<void> {
  const status = getConfigStatus();

  console.log("\nConfiguration");
  report(status.database.configured ? "ok" : "fail", "Database settings", describeGroup(status.database));
  report(status.whatsapp.configured ? "ok" : "fail", "WhatsApp settings", describeGroup(status.whatsapp));
  report(status.auth.configured ? "ok" : "fail", "Admin login settings", describeGroup(status.auth));
  report(
    status.queue.configured ? "ok" : "fail",
    "Queue",
    status.queue.configured ? (status.queue.mode === "qstash" ? "QStash" : "inline (fine for development; use QStash in production)") : describeGroup(status.queue),
  );
  report(status.cron.configured ? "ok" : "skip", "Scheduled recovery (CRON_SECRET)", status.cron.configured ? "" : "needed in production");
  report(status.simulatorEnabled ? "ok" : "skip", "Simulator", status.simulatorEnabled ? "enabled" : "disabled");
  report(status.ai.enabled ? "ok" : "skip", "AI provider", status.ai.enabled ? "" : (status.ai.reason ?? "disabled"));

  console.log("\nConnections");
  if (status.database.configured) {
    const db = await pingDatabase();
    report(db.ok ? "ok" : "fail", "MongoDB", db.ok ? `ping ${db.latencyMs} ms` : "cannot connect (check URI, password, Atlas Network Access)");
  } else {
    report("skip", "MongoDB", "settings incomplete");
  }

  if (status.whatsapp.configured) await checkWhatsApp();
  else report("skip", "WhatsApp API", "settings incomplete");

  console.log("\nNote: this checks credentials only. It sends no messages. Real delivery also depends on Meta business verification.\n");
}

main()
  .catch((error: unknown) => {
    console.error("Setup check failed:", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
