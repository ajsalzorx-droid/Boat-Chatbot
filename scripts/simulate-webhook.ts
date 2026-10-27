/**
 * Sends a SIMULATED, correctly signed WhatsApp webhook to a running server, to test the webhook
 * route, signature check, storage and bot pipeline without Meta.
 *
 * Usage (server running with `npm run dev`):
 *   npm run webhook:simulate -- --text "What are your opening hours?"
 *   npm run webhook:simulate -- --from 971500000001 --name "Test" --text "Hi" --url https://xxxx.ngrok-free.app/api/webhooks/whatsapp
 *
 * IMPORTANT: the bot will try to send its reply through the real WhatsApp API to `--from`.
 * Use your own test number, or expect a delivery error for a fake number. This is not a real
 * customer message and does not prove that Meta can reach your server.
 */
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import { getWhatsAppConfig } from "@/lib/config/env";
import { signMetaPayload } from "@/lib/whatsapp/signature";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      url: { type: "string", default: "http://localhost:3000/api/webhooks/whatsapp" },
      from: { type: "string", default: "10000000000" },
      name: { type: "string", default: "Simulated customer" },
      text: { type: "string", default: "Hello" },
      "bad-signature": { type: "boolean", default: false },
    },
  });

  const config = getWhatsAppConfig();
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: config.businessAccountId,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "SIMULATED", phone_number_id: config.phoneNumberId },
              contacts: [{ wa_id: values.from, profile: { name: values.name } }],
              messages: [
                {
                  id: `wamid.SIMULATED.${randomUUID()}`,
                  from: values.from,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: values.text },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const body = JSON.stringify(payload);
  const signature = values["bad-signature"] ? `sha256=${"0".repeat(64)}` : signMetaPayload(body, config.appSecret);
  const response = await fetch(values.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature },
    body,
  });
  console.log(`SIMULATED webhook → ${values.url}: HTTP ${response.status} ${await response.text()}`);
}

main().catch((error: unknown) => {
  console.error("Failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
