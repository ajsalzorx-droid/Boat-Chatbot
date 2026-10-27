/**
 * Sends ONE real WhatsApp message through the Cloud API: the `hello_world` template (or another
 * approved template). Use it to confirm outbound delivery end to end.
 *
 * Usage:
 *   npm run whatsapp:send-test -- --to 9715XXXXXXXX
 *   npm run whatsapp:send-test -- --to 9715XXXXXXXX --template my_template --lang en
 *
 * With a test number, the recipient must first be added to the allowed list in the Meta app.
 * "Accepted" means Meta accepted the request; actual delivery is reported later by status webhooks.
 */
import { parseArgs } from "node:util";

import { WhatsAppApiError, WhatsAppClient } from "@/lib/whatsapp/client";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      to: { type: "string" },
      template: { type: "string", default: "hello_world" },
      lang: { type: "string", default: "en_US" },
    },
  });
  const to = values.to?.replace(/\D/g, "");
  if (!to) throw new Error("Provide --to with the recipient number including country code");

  try {
    const result = await new WhatsAppClient().sendTemplate({ to, name: values.template, languageCode: values.lang });
    console.log(`Accepted by Meta. Message ID: ${result.messageId}\nWatch for status webhooks (sent/delivered/read) or check the phone.`);
  } catch (error) {
    if (error instanceof WhatsAppApiError) {
      console.error(`Rejected: code ${error.graphCode ?? "?"} (HTTP ${error.graphHttpStatus}): ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error("Failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
