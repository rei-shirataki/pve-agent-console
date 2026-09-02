import { NextRequest, NextResponse } from "next/server";
import { authSecret, authentikConfig, cookieSecure } from "@/lib/auth/config";
import { buildAuthorizeUrl, generatePkce, generateState } from "@/lib/auth/oidc";
import { signPayload } from "@/lib/auth/signed-cookie";
import { OIDC_STATE_COOKIE, OIDC_STATE_TTL_SECONDS, type OidcStatePayload } from "@/lib/auth/oidc-state";

export const runtime = "nodejs";

/** AuthentikへのOIDC認可リクエストを開始する。PKCE検証子・stateを短命Cookieに退避する。 */
export async function GET(request: NextRequest) {
  const cfg = authentikConfig();
  if (!cfg) {
    return NextResponse.json({ error: "Authentikは設定されていません" }, { status: 400 });
  }

  const { verifier, challenge } = generatePkce();
  const state = generateState();
  const rawNext = request.nextUrl.searchParams.get("next") ?? "/";
  // オープンリダイレクト対策: 自サイト内の絶対パスのみ許可する
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  const authorizeUrl = await buildAuthorizeUrl(state, challenge);

  const statePayload: OidcStatePayload = {
    v: verifier,
    s: state,
    n: next,
    exp: Math.floor(Date.now() / 1000) + OIDC_STATE_TTL_SECONDS,
  };
  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set(OIDC_STATE_COOKIE, signPayload(statePayload, authSecret()), {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: OIDC_STATE_TTL_SECONDS,
  });
  return res;
}
