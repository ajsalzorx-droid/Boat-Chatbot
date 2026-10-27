import type { Metadata } from "next";

import { getSettings } from "@/services/settings/settings-service";

export const metadata: Metadata = {
  title: "Privacy Policy",
  // Meta's app review and customers must be able to reach this page, unlike the rest of the platform.
  robots: { index: true, follow: false },
};
export const dynamic = "force-dynamic";

const LAST_UPDATED = "27 October 2026";

/** Public privacy policy for the WhatsApp chatbot, required by Meta to publish the app. */
export default async function PrivacyPage() {
  const settings = await getSettings().catch(() => null);
  const company = settings?.companyName || "The business";
  const contactEmail = settings?.humanSupport.email || "";
  const contactPhone = settings?.humanSupport.phone || settings?.businessWhatsAppNumber || "";
  const address = settings?.address || "";
  const retentionDays = settings?.retention.messageRetentionDays ?? 365;
  const optOut = settings?.messaging.optOutKeywords[0] ?? "STOP";

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 text-slate-800 dark:text-slate-200">
      <h1 className="text-2xl font-semibold">Privacy Policy</h1>
      <p className="mt-1 text-sm text-slate-500">Last updated: {LAST_UPDATED}</p>

      <div className="mt-6 space-y-6 leading-relaxed">
        <p>
          This policy explains how {company} (&quot;we&quot;) handles personal data when you message our WhatsApp business
          number. Our WhatsApp assistant answers common questions automatically, and our staff can read and reply to any
          conversation.
        </p>

        <section>
          <h2 className="text-lg font-semibold">What we collect</h2>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>Your WhatsApp phone number and the profile name WhatsApp shares with us.</li>
            <li>The messages you send us and the replies we send you.</li>
            <li>Delivery information provided by WhatsApp (for example sent, delivered, read).</li>
          </ul>
          <p className="mt-2">We do not ask for payment card details or passwords over WhatsApp.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">How we use it</h2>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>To answer your questions about our products, prices, opening hours and location.</li>
            <li>To let our staff continue the conversation when the assistant cannot help.</li>
            <li>To keep the service secure and working reliably.</li>
          </ul>
          <p className="mt-2">We do not sell your data and do not use it for advertising.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Who processes it</h2>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>WhatsApp / Meta Platforms, which delivers the messages.</li>
            <li>Our hosting and database providers, which store the service and its data.</li>
            <li>
              If enabled, an AI service provider that generates answers from the text of your question. It receives only
              what is needed to answer, not your phone number.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold">How long we keep it</h2>
          <p className="mt-2">
            Messages are deleted automatically after {retentionDays} days. You can ask us to delete your data sooner at any
            time.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Your choices</h2>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>
              Send <strong>{optOut}</strong> to stop receiving messages from us.
            </li>
            <li>Ask us for a copy of your data, a correction, or deletion of your conversation history.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Contact</h2>
          <p className="mt-2">
            {company}
            {address && <>, {address}</>}
          </p>
          {contactEmail && <p>Email: {contactEmail}</p>}
          {contactPhone && <p>Phone / WhatsApp: {contactPhone}</p>}
          {!contactEmail && !contactPhone && <p>Message us on WhatsApp and our staff will help.</p>}
        </section>
      </div>
    </main>
  );
}
