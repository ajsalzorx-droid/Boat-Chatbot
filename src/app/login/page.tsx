import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getPageSession } from "@/lib/auth/guards";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getPageSession().catch(() => null);
  if (session) redirect("/admin");

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-xl font-bold text-white">W</div>
          <h1 className="text-xl font-semibold">Chatbot admin</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to manage WhatsApp conversations</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
