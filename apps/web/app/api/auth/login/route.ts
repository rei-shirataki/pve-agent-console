import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authPassword, authSecret, authUserLabel, authentikConfig, cookieSecure } from "@/lib/auth/config";
import { passwordMatches } from "@/lib/auth/password";
import { createSessionCookieValue, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session";

export const runtime = "nodejs";

const bodySchema = z.object({ password: z.string().min(1) });

export async function POST(request: NextRequest) {
  if (authentikConfig()) {
    return NextResponse.json({ error: "Authentikログインのみ有効です" }, { status: 400 });
  }
  const expected = authPassword();
  if (!expected) {
    return NextResponse.json({ error: "パスワード認証は設定されていません" }, { status: 400 });
  }

  const json: unknown = await request.json();
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (!passwordMatches(parsed.data.password, expected)) {
    return NextResponse.json({ error: "パスワードが違います" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, createSessionCookieValue(authUserLabel(), authSecret()), {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
