import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl font-semibold">WhatsApp Chatbot Platform</h1>
      <p className="text-slate-600 dark:text-slate-400">
        This service answers customer messages sent to the business WhatsApp number. Staff manage conversations, FAQs, products and
        chatbot settings from the admin dashboard.
      </p>
      <Link href="/login" className="w-fit rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
        Admin sign in
      </Link>
    </main>
  );
}
