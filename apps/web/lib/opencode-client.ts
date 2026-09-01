import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import { startOpencodeServer } from "./opencode-server";

let clientPromise: Promise<{ client: OpencodeClient; baseUrl: string }> | undefined;

export function getOpencodeClient(): Promise<{ client: OpencodeClient; baseUrl: string }> {
  clientPromise ??= startOpencodeServer().then(({ baseUrl }) => ({
    client: createOpencodeClient({ baseUrl }),
    baseUrl,
  }));
  return clientPromise;
}
