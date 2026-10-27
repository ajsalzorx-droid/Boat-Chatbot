"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { api } from "@/lib/client/api";

interface NavItem {
  href: string;
  label: string;
  adminOnly?: boolean;
  ownerOnly?: boolean;
  simulatorOnly?: boolean;
}

const ITEMS: NavItem[] = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/conversations", label: "Conversations" },
  { href: "/admin/faqs", label: "FAQs", adminOnly: true },
  { href: "/admin/products", label: "Products & services", adminOnly: true },
  { href: "/admin/settings", label: "Settings", adminOnly: true },
  { href: "/admin/health", label: "System health", adminOnly: true },
  { href: "/admin/whatsapp", label: "WhatsApp connection", adminOnly: true, ownerOnly: true },
  { href: "/admin/simulator", label: "Simulator", adminOnly: true, simulatorOnly: true },
  { href: "/admin/account", label: "My account" },
];

export function AdminNav({
  user,
  isAdmin,
  simulatorEnabled,
}: {
  user: { name: string; email: string; role: string };
  isAdmin: boolean;
  simulatorEnabled: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isOwner = user.role === "owner";
  const items = ITEMS.filter((item) => (!item.adminOnly || isAdmin) && (!item.ownerOnly || isOwner) && (!item.simulatorOnly || simulatorEnabled));

  async function signOut() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/login";
  }

  return (
    <aside className="border-b border-slate-200 bg-white md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:border-b-0 md:border-r dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between px-4 py-4">
        <Link href="/admin" className="flex items-center gap-2 font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">W</span>
          Chatbot admin
        </Link>
        <button type="button" className="rounded-md px-2 py-1 text-sm md:hidden" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          Menu
        </button>
      </div>
      <nav className={`${open ? "block" : "hidden"} px-2 pb-4 md:block`}>
        {items.map((item) => {
          const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={`block rounded-lg px-3 py-2 text-sm ${
                active
                  ? "bg-brand-600/10 font-medium text-brand-700 dark:text-emerald-300"
                  : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
        <div className="mt-6 border-t border-slate-200 px-3 pt-4 text-xs text-slate-500 dark:border-slate-800">
          <p className="truncate font-medium text-slate-700 dark:text-slate-300">{user.name}</p>
          <p className="truncate">{user.email}</p>
          <p className="mt-0.5 capitalize">{user.role}</p>
          <button type="button" onClick={() => void signOut()} className="mt-3 text-sm font-medium text-red-600 hover:underline">
            Sign out
          </button>
        </div>
      </nav>
    </aside>
  );
}
