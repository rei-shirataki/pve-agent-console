import { authPassword, authentikConfig } from "@/lib/auth/config";
import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

function errorMessage(code: string): string {
  switch (code) {
    case "invalid_state":
      return "ログインセッションが無効です。もう一度お試しください。";
    case "oidc_failed":
      return "Authentikでのログインに失敗しました。";
    case "missing_code":
      return "ログインが中断されました。";
    default:
      return "ログインに失敗しました。";
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const authentik = authentikConfig();
  const passwordEnabled = !!authPassword() && !authentik;
  const nextQuery = next ? `?next=${encodeURIComponent(next)}` : "";

  return (
    <div className="login-shell">
      <div className="card login-card">
        <h1>pve-agent-console</h1>
        {error && <p className="login-error">{errorMessage(error)}</p>}
        {authentik && (
          <a className="button login-authentik" href={`/api/auth/oidc/start${nextQuery}`}>
            Authentikでログイン
          </a>
        )}
        {passwordEnabled && <LoginForm next={next} />}
        {!authentik && !passwordEnabled && <p className="muted">認証は設定されていません。</p>}
      </div>
    </div>
  );
}
