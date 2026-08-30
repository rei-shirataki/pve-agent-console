# アーキテクチャ設計

このドキュメントは pve-agent-console の設計方針・コンポーネント構成をまとめたものです。
実装に着手する際は本ドキュメントを起点とし、変更が生じた場合は本ドキュメントも更新すること。

## 0. 目的

Proxmox VE運用に関するタスク(障害調査・構成変更・VM/LXCライフサイクル操作・監視/アラート設定・定期メンテナンス等)を、
Web UI経由でAIエージェントに任せられるようにする。自宅Proxmox VE(LXC構成)を対象とし、就活ポートフォリオとしてGitHub公開する。

### 実装状況(2026-08-30時点)

- 実装済み: `packages/shared-types`, `packages/db`(スキーマ・マイグレーション・`TaskRepository`/`ApprovalRepository`), `packages/agent-adapters`(ClaudeCodeAdapterのみ動作、Gemini/Codexは未実装のスタブ), `apps/mcp-tasks`, `apps/mcp-proxmox`(risk tier別ツール + 承認ゲート), `apps/web`(タスク一覧・作成・詳細、承認キュー、エージェント実行のSSEストリーミング)
- 実機確認済み:
  - `apps/mcp-tasks`をMCPクライアントから接続し`task_create`/`task_list`が動作すること
  - `apps/mcp-proxmox`の承認フロー(pending→approved→冪等な再実行、失敗の記録と再利用)
  - Claude Code CLI(`claude -p --mcp-config ...`)から実際に`apps/mcp-tasks`をstdio MCPサーバーとして接続し、ツール呼び出しが成功すること(この過程で、Windows上でGit BashからCLIへPOSIXスタイルの `/c/Users/...` パスを渡すとサブプロセスがCONNECTION_CLOSEDになることが判明。`C:/Users/...` 形式に直すことで解決。`apps/web/lib/mcp-config.ts`はNode自身の`import.meta.url`から絶対パスを組み立てるため、この問題は発生しない)
  - `apps/web`をビルド・起動し、`/`・`/approvals`のページ応答、`/api/tasks`でのタスク作成・一覧取得のHTTP往復(UTF-8日本語タイトルを含む)
  - PVE本体への接続、および`apps/web`からエージェント実行→実際の承認→再開までの一気通貫のブラウザ操作は未検証(Proxmox VE実機がない開発環境のため)
- 未実装: Gemini CLI / Codex CLI アダプター、認証・アクセス制御(単一ユーザーのホームラボ用途を前提に本パスでは省略。公開ネットワークに直接晒さない運用を想定)

## 1. 全体構成

```
┌─────────────┐   SSE/HTTP    ┌──────────────────────┐
│   Web UI     │◄─────────────┤  apps/web (Next.js)   │
│ (Browser)    │──────────────►│  = フロントエンド     │
└─────────────┘  REST/Server   │  + BFF/オーケストレータ│
                    Actions    └──────┬───────┬────────┘
                                       │spawn  │
                          ┌────────────┘       │
                          ▼                    │
                 ┌──────────────────┐          │
                 │ AI CLI subprocess │          │
                 │ (Claude Code /    │          │
                 │  Gemini CLI /     │          │
                 │  Codex CLI)       │          │
                 │  非対話/printモード │          │
                 └────────┬──────────┘          │
                          │MCP(既定: stdio)      │
                 ┌────────┴──────────┐  ┌────────┴─────────┐
                 │   mcp-proxmox      │  │   mcp-tasks       │
                 │ (Proxmox MCP)      │  │ (タスク管理MCP)   │
                 │ 読取/書込/破壊 3層  │  └────────┬─────────┘
                 │ + 承認ゲート        │           │
                 └────────┬───────────┘           │
                          │ PVE REST API(token)    │
                          ▼                        ▼
                   Proxmox VE クラスタ      packages/db (共有SQLite)
                                            apps/web BFFも直接参照
```

すべての永続状態(タスク・承認キュー・監査ログ)は共有SQLite(`packages/db`)に集約する。
`mcp-proxmox` / `mcp-tasks` はエージェントセッションごとに stdio サブプロセスとして起動されるが、
状態はプロセスのメモリではなくDBファイルにあるため、複数プロセス・複数セッションをまたいでも一貫する。

## 2. コンポーネントの責務

### 2.1 apps/web (Next.js: フロントエンド + BFF/オーケストレータ)
- タスク一覧・詳細・承認キューのUI表示
- 「タスクを依頼する」操作を受けて、設定で選択されたAIプロバイダーのアダプター(`packages/agent-adapters`)を呼び出す
- アダプターからのイベントストリームをSSEでブラウザへ中継
- `approvals`テーブルをポーリングし、pendingの増減をSSEでブラウザへブロードキャスト
- ユーザーの承認/却下操作を`approvals`テーブルへ書き戻す
- 承認後、対象タスクのエージェントセッションを再開する(再開方式はプロバイダーごとに異なる。Claude Codeは`-r/--resume <session_id>`で特定セッションを再開可能。Gemini CLI/Codex CLIのセッション再開機能の有無は実装時に要確認)
- **PVE APIやAIプロバイダーの認証情報そのものは保持しない**(2.3節参照)

### 2.2 packages/agent-adapters (AIプロバイダー・アダプター層)
共通インターフェース(概形):
```ts
interface AgentAdapter {
  id: "claude-code" | "gemini-cli" | "codex-cli";
  isAvailable(): Promise<boolean>;
  run(input: {
    taskId: string;
    prompt: string;
    mcpConfigPath: string;
    resumeSessionId?: string;
  }): AsyncIterable<AgentEvent>;
}
type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; args: unknown }
  | { type: "tool_result"; name: string; result: unknown }
  | { type: "error"; message: string }
  | { type: "done"; sessionId: string };
```
- 各アダプターはCLIをサブプロセス起動し、CLI固有の出力形式を`AgentEvent`へ正規化する
- **ClaudeCodeAdapter**: `claude -p "<prompt>" --output-format stream-json --mcp-config <path> --strict-mcp-config --permission-mode <mode>` を使用(`claude --help`で実在確認済み)。`--verbose`が`-p`+`stream-json`併用時に必須かどうかは実装時に要検証
- **GeminiCliAdapter / CodexCliAdapter**: 検証環境に未インストールのため、具体的なCLIフラグは実装時に各CLIの`--help`で確認してから実装する(本ドキュメントでは仕様を確定させない)
- 有効/無効・デフォルトプロバイダーは設定ファイルで切替可能にする

**認証について**: 各CLIツール自身のローカルログイン(サブスクリプション認証)に委ねる。
`claude login`(Claude Pro/Max)、Gemini CLIのGoogleアカウントログイン、`codex login`(ChatGPT Plus/Pro)。
本アプリの`.env`にAIプロバイダーのAPIキーを置く必要がない設計とし、コミット漏洩リスクを構造的に下げる。

### 2.3 apps/mcp-proxmox (Proxmox MCPサーバー)
- Proxmox VE REST APIを叩くツール群を提供
- ツールごとに risk tier(`read` / `write` / `destructive`)を定義し、サーバー側で一元的に強制する
  - **設計原則**: タスクの「読み取りのみ/書き込みを伴う」という分類はUI上の見た目・期待値に過ぎない。実際のセキュリティ境界は常にMCPサーバー側のツール単位のrisk tierで強制し、オーケストレータやエージェントの自己申告に依存しない
  - risk tierはツール定義本体(コード)にプロパティとして持たせ、コンパイル時に全ツールがtierを持つことを保証する(YAMLのような外部データファイルに委ねると、ツール追加時にtier定義漏れが起きても検知できず「未定義tierはread扱い」のようなfail-openになりかねないため)。運用上の上書きが必要な場合のみ`config/permissions.example.yaml`のような上書き設定を許可する
  - **fail-closed原則**: 何らかの理由でtierが解決できないツールは`destructive`扱いとする
- PVE API tokenは専用の制限されたPVEロールを持つトークンを使う。read/write/destructiveの階層化は、あくまでPVE側ACLの上に重ねる多層防御(defense-in-depth)であり、PVE側ACL設定の代替にはしない

#### 承認フロー(fail-safeなfast-return方式)
当初「MCPツール呼び出し自体をDB状態変化までブロックする」設計を検討したが、Claude Code/Gemini CLI/Codex CLIは
いずれもMCPツール呼び出しに独自のタイムアウト(数十秒オーダー)を持つため、数分単位のブロックはCLI側タイムアウトで
エージェントがエラーと誤認し、承認後に実行されたPVE操作と「エージェントが認識している結果」が食い違う恐れがある。
そのため以下の**fast-return + 再開**方式を採用する。

1. エージェントが`write`/`destructive`ツール(例: `vm_stop`)を呼ぶ
2. `mcp-proxmox`はPVE APIを叩く**前に**、`approvals`テーブルへ`pending`レコードを作成する(tool名・引数・risk tier・task_id・executed_at=NULL)
3. ツールは即座に`{ status: "pending_approval", approvalId }`を返す(ブロックしない)
4. エージェントは`approval_check(approvalId)`という共通ツール(全ゲート対象ツールで共用)を呼ぶ。このツールは内部で最大20〜30秒程度の短いポーリングを行い、状態変化を待つ:
   - `pending`のまま → `{ status: "pending" }`を返す。エージェントはユーザーに承認待ちである旨を伝えてターンを終える
   - `rejected` → 却下理由付きでエラー相当の結果を返す
   - `approved`かつ`executed_at`が未設定 → `executed_at IS NULL`を条件にした compare-and-swap 更新でまず実行権を確保し(取れなかった場合は他プロセスが実行中とみなし結果が書き込まれるまで待つ)、確保できたプロセスだけがPVE APIを実際に実行する。**成功・失敗いずれの場合も**結果(`{ok:true,value}`または`{ok:false,error}`)を`resultJson`に保存してから返す(この分岐でのみ実行することで、リトライ・タイムアウト後の再呼び出しが二重にPVE操作を発生させないことを保証する = 冪等性。失敗時も記録することで、以降の`approval_check`が実行済み扱いのまま結果を返せずpendingを返し続ける不整合を防ぐ)
   - `approved`かつ`executed_at`が設定済み → 保存済みの結果(成功なら`approved`、失敗なら`rejected`+理由)をそのまま返す(再実行しない)。実装・実機での動作確認は `apps/mcp-proxmox` で完了済み
5. `apps/web`は`approvals`テーブルをポーリングし、pendingが増えたらSSEでブラウザに通知。ユーザーがWeb UIで承認/却下すると`approvals`テーブルの`status`を更新する
6. ユーザーの承認がエージェントのターン終了後に行われた場合、`apps/web`は承認完了をトリガーに対象タスクのエージェントセッションを再開する(2.1節)。再開時のプロンプトで`approval_check(approvalId)`の再呼び出しを促す
7. `audit_log`テーブルに「誰が(ユーザー) / いつ / 何を承認・却下したか / 実際に実行された結果」を記録する

### 2.4 apps/mcp-tasks (タスク管理MCPサーバー)
- `task_create` / `task_list` / `task_get` / `task_update_status` / `task_add_comment` / `task_link` などのツールを提供
- 会話履歴とは独立にSQLiteへ永続化。どのAIプロバイダーからも同一インターフェースで操作できる
- 調査中にエージェントが見つけた要対応事項も同じツールでタスク化できる(`origin: "agent"`、`source_task_id`で発生元タスクを追跡)

### 2.5 packages/db (共有データ層)
- Drizzle ORM + SQLite(WALモード)。`mcp-proxmox` / `mcp-tasks` / `apps/web`のBFFが同一DBファイルを参照する
- 主要テーブル:
  - `tasks`: id, title, description, type, status, priority, origin, source_task_id, tags, created_at, updated_at
  - `approvals`: id, task_id, tool_name, arguments_json, risk_tier, status(pending/approved/rejected/timeout), created_at, decided_at, decided_by, executed_at, result_json
  - `audit_log`: id, approval_id, actor, action, detail_json, created_at

## 3. MCP transport

- **既定: stdio**。エージェントCLIの起動時に、そのセッション専用の`mcp-proxmox`/`mcp-tasks`をstdioサブプロセスとして spawn する。状態はDBにあるためプロセスをまたいでも一貫し、CLIごとのMCP transport対応差異(特にstdio-firstなツール)を気にせず全プロバイダーで動作させやすい
- HTTP(Streamable HTTP)transportは将来的なオプションとして残すが、採用する場合は対象CLIがHTTP MCPサーバーをサポートすることを実装時に確認してから切り替える

## 4. タスク永続化: SQLite

| 選択肢 | 評価 |
|---|---|
| **SQLite(採用)** | ファイル1つで運用完結。single-host/single-userのホームラボ用途に十分な性能。WALモードで複数プロセス(mcp-proxmox / mcp-tasks / web BFF)からの同時アクセスも問題ない。バックアップはファイルコピーで済む |
| Postgres | 複数ユーザー・高頻度書き込み・将来のクラウド分散配置を見据えるなら妥当だが、home lab single-userには過剰。別コンテナ運用の手間が増える |
| ファイルベース(JSON/YAML) | 依存は最小だが、承認フローのように複数プロセスが同時に読み書きする用途にはロック機構を自前実装する必要があり不向き |

## 5. タスク分類

```ts
type TaskType = "incident" | "change" | "maintenance" | "other"; // 障害調査 / 構成変更 / 定期メンテナンス / その他
type TaskStatus = "open" | "in_progress" | "blocked" | "done" | "cancelled";
type TaskPriority = "low" | "medium" | "high" | "critical";
type TaskOrigin = "user" | "agent"; // ユーザー起票 か エージェントが自発的に追加したか

interface Task {
  id: string;
  title: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  origin: TaskOrigin;
  sourceTaskId?: string; // 調査中に見つかった場合の発生元タスク
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
```

## 6. Proxmox VE 権限モデル(risk tier例)

| tier | 例 | 挙動 |
|---|---|---|
| `read` | ノード/VM/LXC状態取得、ログ取得、設定参照、バックアップ一覧 | デフォルト許可、即実行 |
| `write` | VM/LXC起動停止・再起動、スナップショット作成、設定変更(CPU/メモリ)、ファイアウォールルール変更 | 承認必須(2.3節フロー) |
| `destructive` | VM/LXC削除、スナップショット削除、ストレージ削除、ディスク縮小、クラスタ離脱 | 承認必須。UI上でより強い警告表示(risk tierに応じた確認UIの強度を分ける) |

## 7. 未確定・実装時に確認が必要な事項

- Gemini CLI / Codex CLIの非対話モードの具体的なCLIフラグ、MCP設定ファイル形式、セッション再開機能の有無(このホストに両CLIが未インストールのため未検証。`packages/agent-adapters`の`GeminiCliAdapter`/`CodexCliAdapter`は未実装のスタブ)
- ライセンス選定(現状README/LICENSEはMITを仮置き。変更の余地あり)
- 承認決定後のエージェントセッション自動再開(`apps/web`が承認完了をトリガーに自動でセッションを再開する仕組み)は未実装。現状は`apps/web`のタスク詳細ページで、ユーザーがブラウザ上で「承認後に再開」ボタンを押すことで`--resume`付きの新しい実行を手動で開始する形に簡略化している(タブを閉じるとセッションIDはブラウザ側の状態としてのみ保持されるため失われる)
- 承認キューのリアルタイム反映は、当初案(BFFがDBをポーリングしSSEでブラウザへブロードキャスト)ではなく、ブラウザが`/api/approvals`を数秒間隔でポーリングする方式に簡略化した(単一ユーザーのホームラボ用途では十分と判断。`apps/web/components/TaskDetailClient.tsx`, `ApprovalQueueClient.tsx`参照)
- ClaudeCodeAdapter経由でmcp-tasks/mcp-proxmoxへ実際に接続できることを実機確認済み(`claude -p --mcp-config ...`)。この検証中に、Git Bashから`/c/Users/...`形式のパスをサブプロセス引数として渡すと接続が`CONNECTION_CLOSED`になる問題を発見。`C:/Users/...`形式に直せば解決するが、そもそも`apps/web`はNode自身が`import.meta.url`から絶対パスを組み立てるため、この問題には該当しない

### 実装時に行った判断(設計時点から変更・追加した点)

- `tsconfig.base.json`の`exactOptionalPropertyTypes`は当初trueにしていたが、zodの`.optional()`推論型との相性が悪く(値がundefinedのプロパティを許容できない)全体で頻発するため無効化した。`strict`/`noUncheckedIndexedAccess`は維持
- TypeScriptは`5.9.3`を採用(`npm view typescript version`時点の最新は`7.0.2`だが、ネイティブ移植版でエコシステム互換性が未成熟なため見送った)
- SQLiteドライバは`drizzle-orm`が`node:sqlite`向けドライバを提供していなかったため`better-sqlite3`を採用(このホストでは追加のビルドツールなしにネイティブバインディングが解決できることを確認済み)
- 承認ゲートの実行権確保(compare-and-swap)は`executed_at IS NULL`条件のUPDATEで行い、実行結果は成功・失敗いずれも`{ok, value|error}`の形でJSON保存する。失敗時に記録し損ねると、以降の`approval_check`が実行済み扱いのままpendingを返し続ける不整合が起きるため、この失敗記録は省略不可(実機テストで確認済み)
