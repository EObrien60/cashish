import type { Metadata } from "next";
import "./globals.css";
import { currentAdmin } from "@/lib/admin-session";
import { logout } from "./auth-actions";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "cashish admin",
  description: "Platform administration — tenants, users and subscriptions.",
};

// Every page under this layout is behind the middleware gate, so rendering the
// chrome only when there is an administrator is about the sign-in screen, which
// is the one route without one.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const admin = await currentAdmin();

  return (
    <html lang="en">
      <body>
        {admin ? (
          <div className="min-h-screen flex flex-col">
            <header className="bg-ink text-white">
              <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center gap-6">
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold tracking-tight">cashish</span>
                  <span className="adm-pill bg-accent text-white">admin</span>
                </div>
                <Nav />
                <div className="ml-auto flex items-center gap-4 text-sm">
                  <span className="text-white/70">{admin.email}</span>
                  <form action={logout}>
                    <button className="text-white/70 hover:text-white underline underline-offset-4">
                      Sign out
                    </button>
                  </form>
                </div>
              </div>
            </header>
            <main className="flex-1 max-w-[1400px] w-full mx-auto px-6 py-8">{children}</main>
          </div>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
