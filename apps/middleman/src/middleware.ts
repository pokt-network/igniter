import NextAuth from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { getLogger, newRequestId, REQUEST_ID_HEADER } from "@igniter/logger";
import { UserRole } from "@igniter/db/middleman/enums";
import authConfig from "./auth.config";
import { SESSION_EXPIRED_MESSAGE } from "./lib/sessionExpired";

const { auth } = NextAuth(authConfig);

// A redirect is wrong for a server action: fetch follows it and re-POSTs the
// action to `/`, outside this matcher, where it fails with a 500. Next's client
// (server-action-reducer.js) rejects the action call with `new Error(await
// res.text())` for a >=400 text/plain response, so the caller receives an Error
// whose message is exactly this body. The client compares the content type with
// `===`, so it must be bare `text/plain`, without a charset.
function actionRejection(status: number, body: string, requestId: string) {
  return new NextResponse(body, {
    status,
    headers: { "content-type": "text/plain", [REQUEST_ID_HEADER]: requestId },
  });
}

// Edge correlation (spec §6): read the inbound x-request-id or mint a fresh
// one, then propagate it both on the forwarded request (so the node runtime
// sees it via `headers()`/withLogging) and on the response (client-visible
// correlation token). Bound per-request via `.with()` — never module-scoped,
// since Edge isolates serve concurrent requests.
const middleware: any = auth(async (req: NextRequest) => {
  const requestId = req.headers.get(REQUEST_ID_HEADER) ?? newRequestId();
  const log = getLogger(["middleman", "middleware"]).with({ request_id: requestId });

  const isServerAction = req.headers.has("next-action");

  const forwardedHeaders = new Headers(req.headers);
  forwardedHeaders.set(REQUEST_ID_HEADER, requestId);

  // A session object alone is not a login: require the user Auth.js decoded from the token.
  //@ts-ignore
  const isLoggedIn = !!req.auth?.user;

  if (!isLoggedIn) {
    if (isServerAction) {
      log.debug("unauthenticated server action rejected", { pathname: req.nextUrl.pathname });
      return actionRejection(401, SESSION_EXPIRED_MESSAGE, requestId);
    }
    log.debug("unauthenticated request redirected", { pathname: req.nextUrl.pathname });
    const response = NextResponse.redirect(new URL("/", req.nextUrl));
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  }

  // Defence in depth: the /admin pages and the admin actions check the role
  // themselves. The role is the one stored in the session token at login.
  //@ts-ignore
  const isOwner = req.auth?.user?.role === UserRole.Owner;

  if (req.nextUrl.pathname.startsWith("/admin") && !isOwner) {
    if (isServerAction) {
      log.debug("non-owner admin server action rejected", { pathname: req.nextUrl.pathname });
      return actionRejection(403, "Forbidden", requestId);
    }
    log.debug("non-owner admin request redirected", { pathname: req.nextUrl.pathname });
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
  matcher: ["/app/:path*", "/admin/:path*"],
};
