# CLAUDE.md

このファイルは pve-agent-console での作業方針をまとめたものです。以降のセッションは本ファイルを読んだ前提で進めます。
設計の詳細・根拠は [docs/architecture.md](docs/architecture.md) に記載しているため、実装前に必ず参照してください。
本ファイルはその要約 + コーディング規約です。設計方針そのものを変更する場合は、まず `docs/architecture.md` を更新すること。

## プロジェクトの目的

Proxmox VE運用タスク(障害調査・構成変更・VM/LXCライフサイクル操作・監視/アラート設定・定期メンテナンス)を、
Web UI経由でAIエージェントに任せられるツール。自宅Proxmox VE(LXC構成)を対象に、就活ポートフォリオとしてGitHub公開する。

## コンポーネント構成(詳細は docs/architecture.md)

```
apps/web              Next.js: フロントエンド + BFF/オーケストレータ
apps/mcp-proxmox        Proxmox MCPサーバー(read/write/destructive risk tier + 承認ゲート)
apps/mcp-tasks           タスク管理MCPサーバー
packages/db                Drizzle + SQLite 共有データ層(tasks / approvals / audit_log)
packages/agent-adapters   AIプロバイダー共通アダプター層(Claude Code / Gemini CLI / Codex CLI)
packages/shared-types      共有の型・zodスキーマ
```

pnpm workspaceによるモノレポ構成。TypeScript strict モードを全パッケージで有効にする。

## 絶対に守る設計原則

1. **risk tierはツール定義本体(コード)に持たせる。外部データファイルへの委譲で「定義漏れ」が起きないようにする**
   - tierが解決できないツールは `destructive` 扱い(fail-closed)。read扱いへのfail-openは禁止
2. **タスクの「読み取りのみ/書き込みを伴う」分類はUI表示上の情報であり、実際のセキュリティ境界にしない**
   - 実際のガードは常に `mcp-proxmox` 側のツール単位のrisk tierで一元的に強制する
3. **write / destructive操作はfast-return + `approval_check`による再開方式で承認を挟む**(docs/architecture.md 2.3節)
   - MCPツール呼び出し自体を数分単位でブロックしない(CLI側タイムアウトに引っかかるため)
   - `approved` かつ `executed_at` 未設定のときのみ実際にPVE APIを実行し、以降は保存済み結果を返す(冪等性を必ず担保する)
4. **AIプロバイダーのAPIキーを `.env` や設定ファイルに置かない**。各CLIのサブスクリプションログイン(`claude login` 等)に委ねる
5. **PVE APIトークンは専用の制限ロールを使う**。アプリ側のrisk tier制御はPVE側ACLの代替ではなく多層防御として扱う
6. **公開前提のリポジトリ**。`.env*`・生成されたMCP設定・SQLiteファイルはコミットしない(`.gitignore`済み)。テンプレート(`*.example`)のみコミットする

## タスク管理の共通ルール

- タスクは `apps/mcp-tasks` のツール経由でのみ作成・更新する(会話履歴とは独立に永続化)
- `type`: `incident` / `change` / `maintenance` / `other`
- `origin`: `user`(ユーザー起票) / `agent`(調査中にエージェントが自発的に追加)。`agent`起票の場合は `sourceTaskId` で発生元を追跡する
- どのAIプロバイダーのアダプターも同じMCPツールインターフェースでタスクを操作する

## コーディング規約

- **コード**: How(どう実装しているか)を書く
- **テストコード**: What(何をテストしているか)を書く
- **コミットログ**: Why(なぜその変更をしたか)を書く
- **コードコメント**: Why not(なぜ別の方法を採らなかったか)を書く
- 上記はユーザーのグローバル方針(`~/.claude/CLAUDE.md`)と同一。本プロジェクト固有の上書きはなし
- 新しいMCPツールを追加する場合は、必ずrisk tierを明示的に指定する(コンパイルエラーで検知できる形にする。オプショナルにしない)
- PVE APIクライアント・DBアクセスなど副作用のあるコードは、テストしやすいよう純粋なロジックと分離する

## Git運用

ユーザーのグローバル `CLAUDE.md` の運用ルール(Issue・ブランチが必要な変更 / 不要な変更の切り分け、worktree運用)にそのまま従う。
本リポジトリは公開前提のため、コミット前に `git status` / `git diff` で意図しないファイル(特に `.env`・DBファイル・生成されたMCP設定)が
含まれていないか必ず確認すること。

## 未確定事項(実装時に確認が必要)

`docs/architecture.md` 7節を参照。特に Gemini CLI / Codex CLI の非対話モードの具体的なフラグ・MCP設定形式・セッション再開機能の有無は、
各CLIをインストールしてから確認し、本ファイルおよび `docs/architecture.md` を更新すること。
