import { adminRoute } from "@/lib/auth/guards";
import { json } from "@/lib/http/api";
import { isSimulatorEnabled } from "@/lib/config/env";
import { toAdminUserDto } from "@/services/dto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute("agent", ({ session }) =>
  Promise.resolve(json({ user: toAdminUserDto(session.user), simulatorEnabled: isSimulatorEnabled() })),
);
