import { fetch, Agent } from "undici";

export interface PveClientOptions {
  /** 例: https://pve.example.internal:8006/api2/json */
  baseUrl: string;
  /** 例: user@pam!pve-agent-console */
  tokenId: string;
  tokenSecret: string;
  /** 自己署名証明書を使っている場合のみtrueにする */
  tlsInsecure?: boolean;
}

export class PveApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "PveApiError";
  }
}

export interface PveNode {
  node: string;
  status: string;
  cpu?: number;
  maxmem?: number;
  uptime?: number;
}

export class PveClient {
  private readonly agent: Agent | undefined;

  constructor(private readonly options: PveClientOptions) {
    // PVEはデフォルトで自己署名証明書を使うため、明示的なオプトインでのみ検証を無効化する。
    this.agent = options.tlsInsecure
      ? new Agent({ connect: { rejectUnauthorized: false } })
      : undefined;
  }

  private async request<T>(method: string, path: string): Promise<T> {
    const url = `${this.options.baseUrl.replace(/\/$/, "")}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `PVEAPIToken=${this.options.tokenId}=${this.options.tokenSecret}`,
      },
      dispatcher: this.agent,
    });
    const bodyText = await res.text();
    if (!res.ok) {
      throw new PveApiError(`PVE API error: ${method} ${path} -> ${res.status}`, res.status, bodyText);
    }
    const parsed = JSON.parse(bodyText) as { data: T };
    return parsed.data;
  }

  // --- read ---------------------------------------------------------

  getVersion() {
    return this.request<{ version: string; release: string; repoid: string }>(
      "GET",
      "/version",
    );
  }

  listNodes() {
    return this.request<PveNode[]>("GET", "/nodes");
  }

  getNodeStatus(node: string) {
    return this.request<Record<string, unknown>>("GET", `/nodes/${encodeURIComponent(node)}/status`);
  }

  listVms(node: string) {
    return this.request<Array<Record<string, unknown>>>(
      "GET",
      `/nodes/${encodeURIComponent(node)}/qemu`,
    );
  }

  listLxc(node: string) {
    return this.request<Array<Record<string, unknown>>>(
      "GET",
      `/nodes/${encodeURIComponent(node)}/lxc`,
    );
  }

  // --- write(承認必須) -------------------------------------------

  startVm(node: string, vmid: number) {
    return this.request<string>(
      "POST",
      `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/start`,
    );
  }

  shutdownVm(node: string, vmid: number) {
    return this.request<string>(
      "POST",
      `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/shutdown`,
    );
  }

  stopVm(node: string, vmid: number) {
    return this.request<string>(
      "POST",
      `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/stop`,
    );
  }

  // --- destructive(承認必須) ---------------------------------------

  deleteVm(node: string, vmid: number) {
    return this.request<string>("DELETE", `/nodes/${encodeURIComponent(node)}/qemu/${vmid}`);
  }
}

export function createPveClientFromEnv(): PveClient {
  const baseUrl = process.env.PVE_API_URL;
  const tokenId = process.env.PVE_API_TOKEN_ID;
  const tokenSecret = process.env.PVE_API_TOKEN_SECRET;
  if (!baseUrl || !tokenId || !tokenSecret) {
    throw new Error(
      "PVE_API_URL / PVE_API_TOKEN_ID / PVE_API_TOKEN_SECRET が設定されていません(.envを確認してください)",
    );
  }
  return new PveClient({
    baseUrl,
    tokenId,
    tokenSecret,
    tlsInsecure: process.env.PVE_API_TLS_INSECURE === "true",
  });
}
