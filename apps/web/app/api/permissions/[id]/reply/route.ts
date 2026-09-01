import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOpencodeClient } from "@/lib/opencode-client";
import { replyToPermission } from "@/lib/opencode-permissions";

export const runtime = "nodejs";

const bodySchema = z.object({
  action: z.enum(["once", "always", "reject"]),
});

/**
 * 承認/却下をopencodeへ転送するだけ。audit_logへの記録はinstrumentation.tsの
 * バックグラウンドイベント購読処理が permission.replied を検知して行う
 * (このAPIがどのクライアントから叩かれても記録経路が1本になるようにするため)。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { baseUrl } = await getOpencodeClient();
  const json: unknown = await request.json();

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    await replyToPermission(baseUrl, id, parsed.data.action);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
