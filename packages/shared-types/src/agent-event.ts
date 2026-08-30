import { z } from "zod";

// 各AIプロバイダーCLIの出力(例: Claude Codeの--output-format stream-json)を
// packages/agent-adapters が正規化した共通イベント形式。
// apps/web はプロバイダーの違いを意識せずこの形式だけを扱う。
export const agentEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("tool_call"), name: z.string(), args: z.unknown() }),
  z.object({
    type: z.literal("tool_result"),
    name: z.string().nullable(),
    result: z.unknown(),
    isError: z.boolean(),
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({
    type: z.literal("done"),
    sessionId: z.string(),
    isError: z.boolean(),
    summary: z.string().nullable(),
  }),
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;
