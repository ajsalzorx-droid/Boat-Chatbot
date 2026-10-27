import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "WhatsApp Chatbot", template: "%s · WhatsApp Chatbot" },
  description: "Customer messaging platform",
  // The platform is an internal tool; keep it out of search indexes.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      {/* Browser extensions (e.g. ColorZilla's `cz-shortcut-listen`) inject attributes on <body>
          before hydration. This only silences attribute mismatches on this element itself;
          mismatches inside the app tree are still reported. */}
      <body className="min-h-screen font-sans" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
