import { NextRequest } from "next/server";
import { z } from "zod";
import { getOpencodeClient } from "@/lib/opencode-client";
import { getDb } from "@/lib/db";
import { TaskRepository } from "@pve-agent-console/db";

export const runtime = "nodejs";

const bodySchema = z.object({
  taskId: z.string(),
  prompt: z.string().min(1),
  agent: z.enum(["investigator", "operator"]).optional(),
});

/**
 * 使用するプロバイダー/モデルをopencode.jsonではなく環境変数で指定する
 * (`OPENCODE_PROVIDER_ID` / `OPENCODE_MODEL_ID`)。未設定時はAPIキー不要な
 * opencode公式の無料モデル(big-pickle)にフォールバックし、ローカル動作確認を
 * すぐ試せるようにする(docs/adr/0001-adopt-opencode.md参照。本番ではAPIキー課金の
 * プロバイダーを明示的に指定することを想定)。
 */
function resolveDefaultModel(): { providerID: string; modelID: string } {
  return {
    providerID: process.env.OPENCODE_PROVIDER_ID ?? "opencode",
    modelID: process.env.OPENCODE_MODEL_ID ?? "big-pickle",
  };
}

// 構造上の付随イベント(session.updated/session.diff/message.updated等)は中継せず、
// フロントエンドは message.part.updated / permission.asked / permission.replied /
// session.status のみ扱う(docs/migration-plan.md Phase 0で確認した実際のイベント名に基づく。
// SDKの型定義は一部実際のイベント名と一致しないため信用せず、実機確認済みの文字列で判定する)。
const RELAYED_EVENT_TYPES = new Set([
  "message.part.updated",
  "permission.asked",
  "permission.replied",
  "session.status",
  "session.error",
]);

export async function POST(request: NextRequest) {
  const json: unknown = await request.json();
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: parsed.error.message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { taskId, prompt, agent } = parsed.data;

  const taskRepo = new TaskRepository(getDb());
  const task = taskRepo.getTask(taskId);
  if (!task) {
    return new Response(JSON.stringify({ error: `task not found: ${taskId}` }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { client } = await getOpencodeClient();

  let sessionId = task.opencodeSessionId;
  if (!sessionId) {
    const created = await client.session.create({ body: { title: task.title } });
    if (!created.data) {
      return new Response(JSON.stringify({ error: "opencode session作成に失敗しました" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
    sessionId = created.data.id;
    taskRepo.setOpencodeSessionId(taskId, sessionId);
  }

  // タスク種別からデフォルトのagentを決める(incidentは読み取り専用のinvestigator、
  // それ以外は書き込み可能なoperator。docs/architecture.md 5節)。
  const selectedAgent = agent ?? (task.type === "incident" ? "investigator" : "operator");

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      };

      try {
        const events = await client.event.subscribe();
        const relay = (async () => {
          for await (const event of events.stream) {
            const type = (event as { type: string }).type;
            const properties = (event as { properties?: { sessionID?: string } }).properties;
            if (properties?.sessionID !== sessionId) continue;
            if (!RELAYED_EVENT_TYPES.has(type)) continue;

            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

            if (
              type === "session.status" &&
              (properties as { status?: { type?: string } }).status?.type === "idle"
            ) {
              close();
              return;
            }
          }
        })();

        await client.session.promptAsync({
          path: { id: sessionId },
          body: {
            model: resolveDefaultModel(),
            agent: selectedAgent,
            parts: [{ type: "text", text: prompt }],
          },
        });

        await Promise.race([relay, new Promise((resolve) => setTimeout(resolve, 10 * 60_000))]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "session.error", properties: { message } })}\n\n`),
        );
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
