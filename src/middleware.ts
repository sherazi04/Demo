import { NextResponse, type NextRequest } from "next/server";

/**
 * Coarse redirect for unauthenticated browsing — presentation only.
 *
 * This is NOT authorization (FR-GOV-007). It only checks whether a session
 * cookie is present, never what role it carries, because middleware runs on the
 * edge without database access. Every route handler and data-touching server
 * component independently calls the guard in `src/auth/guard.ts`, which is the
 * single enforcement point. Deleting this file would change the UX and nothing
 * about who can read what.
 */

/**
 * `/api/health` is public deliberately: it diagnoses the configuration failures
 * that stop anyone signing in, so gating it behind a session would make it
 * useless exactly when it is needed. It reports presence and reachability only,
 * never values — no secret or connection string appears in its response.
 */
const PUBLIC_PATHS = ["/login", "/set-password", "/api/health"];

const SESSION_COOKIES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  // Auth.js v4 names, in case a session cookie predates an upgrade.
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (hasSession) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals, static assets, and the auth API — the
     * auth endpoints must stay reachable while signed out.
     */
    "/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
