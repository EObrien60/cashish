import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "./desktop.css";
import { Sidebar } from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "cashish",
  description: "Lightweight accounting — invoices, statements, VAT.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The desktop shell tags its requests with a custom User-Agent. When present,
  // we add `.desktop` server-side so the desktop skin is on from first paint.
  // Web requests never carry it, so the web view is unaffected.
  const ua = (await headers()).get("user-agent") ?? "";
  const isDesktop = ua.includes("CashishDesktop");

  return (
    <html lang="en" className={isDesktop ? "desktop" : ""}>
      <body>
        {isDesktop && <div className="app-drag-strip" />}
        <Sidebar />
        <main className="pl-60 min-h-screen">
          <div className="mx-auto max-w-6xl px-8 py-8">{children}</div>
        </main>
      </body>
    </html>
  );
}
