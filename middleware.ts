import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

// ---------------------------------------------------------------------------
// The outer gate.
//
// Presence-only: this checks that a session cookie exists, it does not verify
// the signature. Verification happens in currentSession() where the database is
// reachable, and that is what every page and action actually trusts. The job
// here is to bounce anonymous traffic before it costs a render.
//
// /oauth/authorize is deliberately NOT public: it is the one OAuth endpoint that
// needs a human session, so it stays behind the gate and comes back after login
// with its query string intact. /oauth/register and /oauth/token are machine
// endpoints carrying their own client credentials, and /api/mcp authenticates
// itself with an API key or an access token.
// ---------------------------------------------------------------------------

const PUBLIC_PREFIXES = [
  "/login",
  "/accept-invite",
  "/api/mcp",
  "/.well-known/",
  "/oauth/register",
  "/oauth/token",
  "/_next/",
  "/favicon",
];

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // The root layout needs to know which page is rendering so it can skip the app
  // chrome on the sign-in screens. A Server Component cannot read the pathname,
  // so it is forwarded as a request header.
  const withPath = () => {
    const headers = new Headers(request.headers);
    headers.set("x-pathname", pathname);
    return NextResponse.next({ request: { headers } });
  };

  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return withPath();
  }
  if (request.cookies.get(SESSION_COOKIE)?.value) return withPath();

  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
