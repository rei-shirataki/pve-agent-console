import { NextResponse, type NextRequest } from "next/server";
import { authSecret, isAuthEnabled } from "@/lib/auth/config";
import { SESSION_COOKIE, verifySessionCookieValue } from "@/lib/auth/session";

/**
 * 全ルートを保護するProxy(旧middleware。Next.js 16でファイル規約がmiddleware→proxyへ変更
 * されたことを実機確認した上で対応。docs/architecture.md参照)。
 * `/api/*`は401 JSON、それ以外は/loginへのリダイレクトを返す
 * (クライアント側のポーリング/SSE読み取りがHTMLログインページをJSONとしてparseして
 * 無言で失敗する、という事故を避けるため。advisorレビューで指摘された観点)。
 */
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/oidc/start",
  "/api/auth/oidc/callback",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function proxy(request: NextRequest) {
  if (!isAuthEnabled()) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const session = verifySessionCookieValue(request.cookies.get(SESSION_COOKIE)?.value, authSecret());
  if (session) {
    const headers = new Headers(request.headers);
    headers.set("x-pve-user", session.u);
    return NextResponse.next({ request: { headers } });
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
