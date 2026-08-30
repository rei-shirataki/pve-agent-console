# pve-agent-console

Proxmox VE の運用タスク(障害調査・構成変更・VM/LXCのライフサイクル操作・監視/アラート設定・定期メンテナンス等)を、
Web UI経由でAIエージェントに任せられるツールです。自宅Proxmox VE(LXC構成)を対象に開発しています。

> **Status: 実装初期段階**。`apps/mcp-tasks` / `apps/mcp-proxmox` / `apps/web` は実装済みで、実際のMCPクライアント・Claude Code CLI・
> ブラウザ経由での疎通を確認済みです(実PVE環境への接続は未検証)。設計方針は [docs/architecture.md](docs/architecture.md) を参照してください。

## コンセプト

- **AIバックエンドはベンダー非依存**: Claude Code / Gemini CLI / Codex CLI などをアダプター層で抽象化し、設定で差し替え・有効化できる
- **Proxmox VEの操作はすべてMCPサーバー経由**: 読み取り系はデフォルト許可、書き込み・破壊的操作はrisk tierで分類し、実行前にユーザー承認を必須にする
- **タスク管理は会話履歴と独立して永続化**: 障害調査・構成変更・その他問わず共通のタスクとして記録し、セッションをまたいで残る
- **公開前提**: 認証情報・APIトークンの類は構造的にリポジトリへ混入しない設計にしている

## コンポーネント構成

```
apps/web            Next.js製フロントエンド + BFF/オーケストレータ
apps/mcp-proxmox     Proxmox MCPサーバー(読取/書込/破壊 risk tier + 承認ゲート)
apps/mcp-tasks       タスク管理MCPサーバー
packages/db           Drizzle + SQLite 共有データ層
packages/agent-adapters  AIプロバイダー共通アダプター層(ClaudeCodeAdapterのみ実装、他はスタブ)
packages/shared-types    共有の型・zodスキーマ
```

詳細は [docs/architecture.md](docs/architecture.md) を参照してください。実装/コーディング規約は [CLAUDE.md](CLAUDE.md) にまとめています。

## セットアップ

前提: Node.js 22+ / pnpm 10+ / Claude Code CLIがインストール済みで `claude login` 済みであること
(認証はCLI自身のサブスクリプションログインに委ねるため、本アプリの`.env`にAPIキーは置かない)。

> **セキュリティ上の注意**: `apps/web` には認証・アクセス制御を実装していません(単一ユーザーの
> ホームラボ用途を前提としたスコープ判断。詳細は [docs/architecture.md](docs/architecture.md) 実装状況を参照)。
> `next start` はデフォルトで全インターフェース(`0.0.0.0`)にバインドします。信頼できるLAN内でのみ
> 動かし、インターネットへポート開放・リバースプロキシ公開は行わないでください。

```bash
pnpm install

# .envを作成し、PVE接続情報などを埋める(.envはコミットされない)
cp .env.example .env

# 共有DBのマイグレーションを適用(DATABASE_PATHは.envの値を使う場合はdotenv系ツールで読み込むか、
# 下記のように環境変数として明示的に渡す)
DATABASE_PATH=./data/pve-agent-console.db pnpm db:migrate

# 全パッケージをビルド(apps/web/mcp-tasks/mcp-proxmoxはNode.js runtimeを前提とする)
pnpm build

# Web UIを起動(BFFがmcp-tasks/mcp-proxmoxをstdioサブプロセスとして都度起動する)
pnpm --filter @pve-agent-console/web start
```

開発時は `pnpm --filter @pve-agent-console/web dev` でNext.jsの開発サーバーを使えます。
`apps/mcp-tasks` / `apps/mcp-proxmox` を単独のMCPサーバーとして手元で疎通確認したい場合は、
各ディレクトリで `pnpm dev`(tsxでソースを直接実行)を使ってください。

## ライセンス

[MIT](LICENSE)
