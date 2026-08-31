import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/admin-session-cookie";

// ---------------------------------------------------------------------------
// The outer gate.
//
// Presence-only, exactly as the books app's is: this checks that a cookie
// exists, not that it verifies. Verification happens in currentAdmin(), where
// the database is reachable and the account can be re-read, and that is what
// every page actually trusts. The job here is to bounce anonymous traffic
// before it costs a render.
//
// The default is closed. There is no public surface in this application at all
// beyond the sign-in screen — no marketing page, no registration, no machine
// endpoint that authenticates itself — so the allowlist below is the whole of
// it, and anything new is gated unless somebody deliberately adds it here.
//
// This file must stay under src/. At the app root Next.js ignores it silently
// and the gate simply never runs, with no error to notice.
// ---------------------------------------------------------------------------

const PUBLIC_PREFIXES = ["/login", "/_next/", "/favicon"];

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }
  if (request.cookies.get(ADMIN_SESSION_COOKIE)?.value) {
    return NextResponse.next();
  }

  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
