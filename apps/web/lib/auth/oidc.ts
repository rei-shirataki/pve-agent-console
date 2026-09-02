import { createHash, createPublicKey, randomBytes, verify as cryptoVerify } from "node:crypto";
import { authentikConfig } from "./config";

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

const DISCOVERY_TTL_MS = 10 * 60 * 1000;
let discoveryCache: { issuer: string; value: Discovery; fetchedAt: number } | null = null;

async function getDiscovery(issuer: string): Promise<Discovery> {
  if (
    discoveryCache &&
    discoveryCache.issuer === issuer &&
    Date.now() - discoveryCache.fetchedAt < DISCOVERY_TTL_MS
  ) {
    return discoveryCache.value;
  }
  const res = await fetch(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
  const value = (await res.json()) as Discovery;
  discoveryCache = { issuer, value, fetchedAt: Date.now() };
  return value;
}

function base64url(input: Buffer): string {
  return input.toString("base64url");
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function generateState(): string {
  return base64url(randomBytes(16));
}

export async function buildAuthorizeUrl(state: string, codeChallenge: string): Promise<string> {
  const cfg = authentikConfig();
  if (!cfg) throw new Error("Authentik is not configured");
  const discovery = await getDiscovery(cfg.issuer);
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

interface TokenResponse {
  id_token: string;
  token_type: string;
}

export async function exchangeCodeForToken(code: string, codeVerifier: string): Promise<TokenResponse> {
  const cfg = authentikConfig();
  if (!cfg) throw new Error("Authentik is not configured");
  const discovery = await getDiscovery(cfg.issuer);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code_verifier: codeVerifier,
  });
  const res = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Authentik token exchange failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

interface Jwk {
  kty: string;
  kid: string;
  [key: string]: unknown;
}

const JWKS_TTL_MS = 10 * 60 * 1000;
let jwksCache: { jwksUri: string; keys: Jwk[]; fetchedAt: number } | null = null;

async function getJwks(jwksUri: string): Promise<Jwk[]> {
  if (jwksCache && jwksCache.jwksUri === jwksUri && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(jwksUri);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const data = (await res.json()) as { keys: Jwk[] };
  jwksCache = { jwksUri, keys: data.keys, fetchedAt: Date.now() };
  return data.keys;
}

export interface IdTokenClaims {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  preferred_username?: string;
  email?: string;
}

/**
 * id_token(JWT)をAuthentikのJWKSで署名検証し、クレームを返す。
 * `@opencode-ai/sdk`の型を鵜呑みにしない、というこのリポジトリの方針と同様、
 * 外部IdPのレスポンスも実装依存の細部(RS256前提、jwks_uriの形)を仮定しすぎないよう
 * 標準のOIDC discoveryドキュメント経由で解決する(docs/architecture.md参照)。
 */
export async function verifyIdToken(idToken: string): Promise<IdTokenClaims> {
  const cfg = authentikConfig();
  if (!cfg) throw new Error("Authentik is not configured");
  const discovery = await getDiscovery(cfg.issuer);

  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("malformed id_token");
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8")) as {
    alg: string;
    kid: string;
  };
  if (header.alg !== "RS256") throw new Error(`unsupported id_token alg: ${header.alg}`);

  const keys = await getJwks(discovery.jwks_uri);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("no matching JWKS key for id_token kid");

  const publicKey = createPublicKey({ key: jwk as unknown as JsonWebKey, format: "jwk" });
  const signature = Buffer.from(sigB64, "base64url");
  const signedData = Buffer.from(`${headerB64}.${payloadB64}`);
  if (!cryptoVerify("RSA-SHA256", signedData, publicKey, signature)) {
    throw new Error("id_token signature verification failed");
  }

  const claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as IdTokenClaims;
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp < now) throw new Error("id_token expired");
  if (claims.iss !== discovery.issuer) throw new Error(`id_token issuer mismatch: ${claims.iss}`);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(cfg.clientId)) throw new Error("id_token audience mismatch");

  return claims;
}
