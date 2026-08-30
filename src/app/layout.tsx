import type { Metadata } from "next";
import { headers } from "next/headers";
import { Fraunces, Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import "./desktop.css";
import "./marketing.css";
import { Sidebar } from "@/components/Sidebar";
import { currentSession } from "@/lib/session";
import { membershipsFor } from "@/lib/auth";
import { switchTenant, logout } from "./auth-actions";

// Fraunces for display: a variable serif with optical-size and "wonk" axes, so
// headings read as set type rather than as a UI font scaled up. Archivo for body
// text, IBM Plex Mono for figures — money wants tabular numerals.
const display = Fraunces({
  subsets: ["latin"],
  axes: ["SOFT", "WONK", "opsz"],
  variable: "--font-display",
  display: "swap",
});
const body = Archivo({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const figure = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-figure",
  display: "swap",
});

export const metadata: Metadata = {
  title: "cashish",
  description: "Lightweight accounting — invoices, statements, VAT.",
};

// Screens that stand alone, with no sidebar and no tenant: you are not in a
// business yet when you are looking at them.
const BARE_PREFIXES = ["/login", "/accept-invite", "/register", "/pricing", "/oauth/"];

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headerList = await headers();
  // The desktop shell tags its requests with a custom User-Agent. When present,
  // we add `.desktop` server-side so the desktop skin is on from first paint.
  const ua = headerList.get("user-agent") ?? "";
  const isDesktop = ua.includes("CashishDesktop");
  const pathname = headerList.get("x-pathname") ?? "";
  const session = await currentSession();
  // No session means no app chrome, whatever the path — a visitor on "/" gets
  // the marketing page, not an empty sidebar.
  const bare = !session || BARE_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (bare) {
    return (
      <html
        lang="en"
        className={`${display.variable} ${body.variable} ${figure.variable} ${
          isDesktop ? "desktop" : ""
        }`}
      >
        <body>{children}</body>
      </html>
    );
  }

  const tenants = session ? await membershipsFor(session.userId) : [];
  const active = tenants.find((t) => t.tenantId === session?.tenantId) ?? null;

  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${figure.variable} ${
        isDesktop ? "desktop" : ""
      }`}
    >
      <body>
        <Sidebar
          role={session?.role ?? "viewer"}
          tenants={tenants.map((t) => ({ id: t.tenantId, name: t.name }))}
          activeTenantId={active?.tenantId ?? null}
          switchTenant={switchTenant}
          logout={logout}
        />
        <main className="pl-60 min-h-screen">
          <div className="mx-auto max-w-6xl px-8 py-8">{children}</div>
        </main>
      </body>
    </html>
  );
}
