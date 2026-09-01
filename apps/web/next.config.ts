import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // mcp-proxmox/mcp-tasksをサブプロセス起動する都合上、Route HandlerはNode runtimeのみを想定する
  // (Edge runtimeではchild_processが使えない)。
};

export default nextConfig;
