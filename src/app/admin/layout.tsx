import type { ReactNode } from "react";

import { hasAccess, requirePageSession } from "@/lib/auth/guards";
import { isSimulatorEnabled } from "@/lib/config/env";

import { AdminNav } from "./admin-nav";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requirePageSession("agent");
  const isAdmin = hasAccess(session.user.role, "admin");

  return (
    <div className="min-h-screen md:flex">
      <AdminNav
        user={{ name: session.user.name, email: session.user.email, role: session.user.role }}
        isAdmin={isAdmin}
        simulatorEnabled={isAdmin && isSimulatorEnabled()}
      />
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
