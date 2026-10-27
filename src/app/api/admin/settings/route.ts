import { adminRoute } from "@/lib/auth/guards";
import { json, readJson } from "@/lib/http/api";
import { logger } from "@/lib/logging/logger";
import { settingsSchema } from "@/lib/validation/admin";
import { toSettingsDto } from "@/services/dto";
import { getSettings, updateSettings } from "@/services/settings/settings-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute("admin", async () => json({ settings: toSettingsDto(await getSettings()) }));

export const PUT = adminRoute("admin", async ({ request, session }) => {
  const input = await readJson(request, settingsSchema, 200_000);
  const settings = await updateSettings(input);
  logger.info("settings.updated", { by: session.user._id.toString() });
  return json({ settings: toSettingsDto(settings) });
});
