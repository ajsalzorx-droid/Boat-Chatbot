import { adminRoute } from "@/lib/auth/guards";
import { json } from "@/lib/http/api";
import { getSettings } from "@/services/settings/settings-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Saved replies for the conversation reply box. Readable by every role; edited in Settings. */
export const GET = adminRoute("agent", async () => {
  const settings = await getSettings();
  return json({ items: settings.savedReplies.map(({ title, text }) => ({ title, text })) });
});
