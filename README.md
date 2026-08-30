# pve-agent-console

Proxmox VE の運用タスク(障害調査・構成変更・VM/LXCのライフサイクル操作・監視/アラート設定・定期メンテナンス等)を、
Web UI経由でAIエージェントに任せられるツールです。自宅Proxmox VE(LXC構成)を対象に開発しています。

> **Status: 設計フェーズ**。まだ実装コードはありません。設計方針は [docs/architecture.md](docs/architecture.md) を参照してください。

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
packages/agent-adapters  AIプロバイダー共通アダプター層
packages/shared-types    共有の型・zodスキーマ
```

詳細は [docs/architecture.md](docs/architecture.md) を参照してください。実装/コーディング規約は [CLAUDE.md](CLAUDE.md) にまとめています。

## セットアップ

実装が着手され次第、このセクションを更新します。認証情報は `.env.example` をコピーして `.env` を作成し、
値を埋めてください(`.env` はコミットされません)。

## ライセンス

[MIT](LICENSE)
