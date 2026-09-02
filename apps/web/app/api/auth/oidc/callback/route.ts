import { NextRequest, NextResponse } from "next/server";
import { authSecret, authentikConfig, cookieSecure } from "@/lib/auth/config";
import { exchangeCodeForToken, verifyIdToken } from "@/lib/auth/oidc";
import { OIDC_STATE_COOKIE, type OidcStatePayload } from "@/lib/auth/oidc-state";
import { createSessionCookieValue, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session";
import { verifyPayload } from "@/lib/auth/signed-cookie";

export const runtime = "nodejs";

/** Authentikからのcode付きリダイレクトを受け、トークン交換→id_token検証→自前セッション確立を行う。 */
export async function GET(request: NextRequest) {
  const cfg = authentikConfig();
  if (!cfg) {
    return NextResponse.json({ error: "Authentikは設定されていません" }, { status: 400 });
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!code || !state) {
    return NextResponse.redirect(new URL("/login?error=missing_code", request.url));
  }

  const statePayload = verifyPayload<OidcStatePayload>(
    request.cookies.get(OIDC_STATE_COOKIE)?.value,
    authSecret(),
  );
  if (!statePayload || statePayload.exp < Math.floor(Date.now() / 1000) || statePayload.s !== state) {
    return NextResponse.redirect(new URL("/login?error=invalid_state", request.url));
  }

  try {
    const token = await exchangeCodeForToken(code, statePayload.v);
    const claims = await verifyIdToken(token.id_token);
    const user = claims.preferred_username ?? claims.email ?? claims.sub;

    const res = NextResponse.redirect(new URL(statePayload.n || "/", request.url));
    res.cookies.set(SESSION_COOKIE, createSessionCookieValue(user, authSecret()), {
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSecure(),
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    res.cookies.delete(OIDC_STATE_COOKIE);
    return res;
  } catch (err) {
    console.error("[auth] Authentik login failed:", err);
    return NextResponse.redirect(new URL("/login?error=oidc_failed", request.url));
  }
}
