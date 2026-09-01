# CLAUDE.md

このファイルは pve-agent-console での作業方針をまとめたものです。以降のセッションは本ファイルを読んだ前提で進めます。
設計の詳細・根拠は [docs/architecture.md](docs/architecture.md) に記載しているため、実装前に必ず参照してください。
アーキテクチャ転換の経緯は [docs/adr/0001-adopt-opencode.md](docs/adr/0001-adopt-opencode.md)、実装の作業分解は
[docs/migration-plan.md](docs/migration-plan.md) を参照。本ファイルはその要約 + コーディング規約です。
設計方針そのものを変更する場合は、まず該当するdocsファイルを更新すること。

## プロジェクトの目的

Proxmox VE運用タスク(障害調査・構成変更・VM/LXCライフサイクル操作・監視/アラート設定・定期メンテナンス)を、
Web UI経由でAIエージェントに任せられるツール。自宅Proxmox VE(LXC構成)を対象に、就活ポートフォリオとしてGitHub公開する。

## アーキテクチャ方針(2026-08-31 opencode採用に転換、2026-09-01 移行実装完了)

AIバックエンドは自作アダプター層ではなく、**OSSのAIコーディングエージェント opencode**
(https://github.com/anomalyco/opencode, MIT License)の headless server(`opencode serve`)+
公式SDK(`@opencode-ai/sdk`)経由で扱う。`apps/web`はopencode serverのクライアントという位置づけ。
経緯・判断根拠は [docs/adr/0001-adopt-opencode.md](docs/adr/0001-adopt-opencode.md)、実装の詳細な記録
(実機検証で判明したこと・変更点)は [docs/migration-plan.md](docs/migration-plan.md) を参照。

```
apps/web              Next.js: フロントエンド + BFF                              [実装済み・E2E実機検証済み]
apps/mcp-proxmox        Proxmox MCPサーバー(read/write/destructive risk tierのメタデータ) [実装済み。承認ブロックロジックは撤去済み]
apps/mcp-tasks           タスク管理MCPサーバー                                    [変更不要。opencodeのmcp設定に登録するだけ]
packages/db                Drizzle + SQLite 共有データ層(tasks / audit_log)        [実装済み(opencodeSessionId追加、approvals→audit_logに縮小)]
packages/shared-types      共有の型・zodスキーマ                                 [実装済み(agent-event.ts/approval.tsは削除、audit-log.tsを新設)]
```

`packages/agent-adapters`は削除済み(opencodeに完全委譲)。

`apps/web`のUIは2026-09-02に「ダッシュボード/タスク詳細/承認キューを別ページ」から「左サイドバー(タスク一覧+
承認キュー件数) + メイン(選択中タスクとの会話ビュー)」というチャット中心の1画面構成へ全面刷新した
(Claude Code/claude.aiのような使用感を意図)。承認プロンプトも会話にインライン表示する。配色はopencode公式
Web UIを実機調査した実測値ベース(docs/architecture.md 2.1節参照)。新規UIを追加する際もこのチャット中心の
構成を踏襲し、別ページに機能を切り出す前にまず会話ビューへのインライン統合を検討すること。

- `opencode serve`は`apps/web`(Next.js)の起動時に`instrumentation.ts`から子プロセスとして自動spawnする(別プロセス常駐にはしない)
- `apps/mcp-proxmox`・`apps/mcp-tasks`は変更を最小限にし、opencodeの`opencode.json`の`mcp`設定から接続する
- pnpm workspaceによるモノレポ構成。TypeScript strict モードを全パッケージで有効にする
  (ただし`exactOptionalPropertyTypes`はzodの`.optional()`型推論との相性が悪いため無効化。docs/architecture.md参照)

## 絶対に守る設計原則

1. **risk tier(read/write/destructive)はツール定義本体(コード)に持たせる。外部データファイルへの委譲で「定義漏れ」が起きないようにする**
   - tierが解決できないツールはopencodeの`permission`設定で`deny`扱い(fail-closed)。`allow`へのfail-openは禁止
   - opencode移行後もこの原則は維持する。risk tierは「opencodeのpermission設定(`allow`/`ask`/`deny`)を生成する根拠」および
     「UI上のバッジ・警告表示の強度」として使う
2. **タスクの「読み取りのみ/書き込みを伴う」分類はUI表示上の情報であり、それ単体をセキュリティ境界にしない**
   - 実際のガードは常にopencodeの`permission`設定(ツール単位)、および可能なら`agent`機能(investigator/operator)による
     二重の強制で担保する。UI側のタスク種別選択は「どのagentを使うか」のヒントに過ぎない
3. **write / destructive操作の実行前承認は、自前でフルスクラッチせずopencodeのpermission機構(`ask`)に乗せる**
   - opencodeがツール呼び出しをサーバー内部でブロックし、`permission.asked`イベントを発行、
     `POST /permission/{requestID}/reply`(SDKに便利メソッドがないため生のHTTPを叩く。`lib/opencode-permissions.ts`)で
     再開する仕組みを標準搭載している。自前の承認ブロック・冪等実行ロジック(旧`apps/mcp-proxmox/approval-gate.ts`)は撤去済み
   - 自前DBの`audit_log`は「誰が・いつ・何を承認/却下したか」を記録する**受動的な監査ログ**としてのみ残す
     (opencode移行前は`approvals`テーブル自体がブロックの実体を兼ねていたが、それはやめる)
4. **AIプロバイダーの認証情報を `.env` や設定ファイルに直接置かない**。APIキー課金を基本とし、`.env`に置く場合も
   コミットされない構造を維持する。Claude Pro/Maxサブスクリプションのopencode経由利用は非公式(Anthropic ToS上グレー)と
   判明しているため、デフォルトにはせず、READMEにリスクを明記した上でのオプトイン機能としてのみ用意する
5. **PVE APIトークンは専用の制限ロールを使う**。アプリ側のrisk tier制御はPVE側ACLの代替ではなく多層防御として扱う
6. **opencodeの組み込みツール(bash/edit/write/read)は全てdenyし、MCPツールのみに用途を限定する**
   (Proxmox運用タスクに役割を厳密に限定し、ホスト上での任意コマンド実行・ファイル編集のリスクを持ち込まない判断。
   docs/adr/0001参照)
7. **公開前提のリポジトリ**。`.env*`・生成されたopencode設定・SQLiteファイルはコミットしない(`.gitignore`済み)。
   テンプレート(`*.example`)のみコミットする

## タスク管理の共通ルール

- タスクは `apps/mcp-tasks` のツール経由でのみ作成・更新する(会話履歴とは独立に永続化)
- `type`: `incident` / `change` / `maintenance` / `other`
- `origin`: `user`(ユーザー起票) / `agent`(調査中にエージェントが自発的に追加)。`agent`起票の場合は `sourceTaskId` で発生元を追跡する
- タスクとopencodeセッションは`tasks.opencodeSessionId`で対応づける(1タスク=1セッションを基本とし、追加の指示は
  同じセッションに`session.prompt()`を重ねることで会話を継続する。自前のresume処理は不要)

## コーディング規約

- **コード**: How(どう実装しているか)を書く
- **テストコード**: What(何をテストしているか)を書く
- **コミットログ**: Why(なぜその変更をしたか)を書く
- **コードコメント**: Why not(なぜ別の方法を採らなかったか)を書く
- 上記はユーザーのグローバル方針(`~/.claude/CLAUDE.md`)と同一。本プロジェクト固有の上書きはなし
- 新しいMCPツールを追加する場合は、必ずrisk tierを明示的に指定する(コンパイルエラーで検知できる形にする。オプショナルにしない)
- PVE APIクライアント・DBアクセスなど副作用のあるコードは、テストしやすいよう純粋なロジックと分離する
- opencode周りの実装(パーミッション応答API、MCPツールパーミッションの挙動)はドキュメント・SDK型定義の記載が
  実際の挙動とずれていることがある(`@opencode-ai/sdk`の型には`permission.asked`イベントが存在せず、
  `permission.replied`のプロパティ名も型定義と実際の値が食い違う、等)。**型やドキュメントを鵜呑みにせず実機で
  検証してから**コードに反映すること(docs/migration-plan.md Phase 0参照)
- Next.js(Turbopack)配下では`import.meta.resolve`のような動的ESM APIが`next build`は通っても`next start`実行時に
  壊れることがある(実例: docs/architecture.md「実装時に行った判断」参照)。ビルドが通ることと実際に動くことは別、
  という前提で`next start`まで実機確認すること

## Git運用

ユーザーのグローバル `CLAUDE.md` の運用ルール(Issue・ブランチが必要な変更 / 不要な変更の切り分け、worktree運用)にそのまま従う。
本リポジトリは公開前提のため、コミット前に `git status` / `git diff` で意図しないファイル(特に `.env`・DBファイル・生成された
opencode設定)が含まれていないか必ず確認すること。

## 将来的な拡張方針(設計メモ。今回のスコープでは実装しない)

### Proxmox VE Helper Scripts形式のワンライナーインストーラー

community-scripts/ProxmoxVE のようなワンライナー(`bash -c "$(curl ...)"`)でLXCとして構築できるようにしたい。
段階を踏む想定:

1. まず自リポジトリ独自のインストールスクリプトを用意する(公式Helper Scriptsのフォーマット・作法を参考にしつつ、
   このリポジトリ内で完結させる)
2. 運用が安定してから、community-scripts/ProxmoxVE本体への収録PRを検討する

### 初回起動時セットアップウィザード

初回起動時のみ、以下を入力させるセットアップウィザードを表示し、完了後は通常のダッシュボードに遷移する構成にしたい:

- Proxmox API接続情報(URL・トークン)
- AIプロバイダー設定(opencodeのprovider/認証)
- 管理者アカウント作成

現状`apps/web`には認証機構がなく単一ユーザー前提のため、セットアップウィザードの実装は「認証・アクセス制御の導入」と
セットで設計する必要がある(現時点では未着手・未設計)。
