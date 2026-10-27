import { adminRoute } from "@/lib/auth/guards";
import { connectToDatabase } from "@/lib/db/mongoose";
import { json } from "@/lib/http/api";
import { AdminUser } from "@/models/admin-user";
import { toAdminUserDto } from "@/services/dto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Active team members, for conversation assignment. Accounts are managed with the CLI. */
export const GET = adminRoute("agent", async () => {
  await connectToDatabase();
  const users = await AdminUser.find({ active: true }).select({ email: 1, name: 1, role: 1 }).sort({ name: 1 }).lean();
  return json({ items: users.map(toAdminUserDto) });
});
