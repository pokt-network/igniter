import NextAuth from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { getLogger, newRequestId, REQUEST_ID_HEADER } from "@igniter/logger";
import authConfig from "./auth.config";

const { auth } = NextAuth(authConfig);

// Edge correlation (spec §6): read the inbound x-request-id or mint a fresh
// one, then propagate it both on the forwarded request (so the node runtime
// sees it via `headers()`/withLogging) and on the response (client-visible
// correlation token). Bound per-request via `.with()` — never module-scoped,
// since Edge isolates serve concurrent requests. Mirrors apps/middleman/src/middleware.ts.
const middleware: any = auth(async (req: NextRequest) => {
  const requestId = req.headers.get(REQUEST_ID_HEADER) ?? newRequestId();
  const log = getLogger(["provider", "middleware"]).with({ request_id: requestId });

  const forwardedHeaders = new Headers(req.headers);
  forwardedHeaders.set(REQUEST_ID_HEADER, requestId);

  //@ts-ignore
  const isLoggedIn = !!req.auth;

  if (!isLoggedIn) {
    log.info("unauthenticated request redirected", { pathname: req.nextUrl.pathname });
    const response = NextResponse.redirect(new URL("/", req.nextUrl));
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  }

  const response = NextResponse.next({ request: { headers: forwardedHeaders } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
});

export default middleware;

export const config = {
  matcher: ["/app/:path*", '/admin/:path*'],
};
