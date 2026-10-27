import { adminRoute } from "@/lib/auth/guards";
import { json } from "@/lib/http/api";
import { WhatsAppApiError, WhatsAppClient } from "@/lib/whatsapp/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only connection test against the Graph API. Sends no message. */
export const POST = adminRoute("admin", async () => {
  try {
    const info = await new WhatsAppClient().getPhoneNumberInfo();
    return json({ ok: true, ...info });
  } catch (error) {
    if (error instanceof WhatsAppApiError) {
      const hint =
        error.graphCode === 190
          ? "The access token is invalid or expired. Generate a new one in the Meta app."
          : error.graphCode === 100
            ? "The phone number ID was not found or the token lacks permission."
            : "WhatsApp API request failed.";
      return json({ ok: false, code: error.graphCode, hint });
    }
    return json({ ok: false, code: null, hint: "WhatsApp is not configured on the server." });
  }
});
