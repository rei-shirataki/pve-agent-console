# アーキテクチャ設計

このドキュメントは pve-agent-console の設計方針・コンポーネント構成をまとめたものです。
実装に着手する際は本ドキュメントを起点とし、変更が生じた場合は本ドキュメントも更新すること。

> **2026-08-31: AIバックエンドをopencodeに切り替える方針転換を行い、2026-09-01に移行実装が完了した。**
> 転換の経緯・判断根拠は [docs/adr/0001-adopt-opencode.md](adr/0001-adopt-opencode.md)、実装の詳細な記録は
> [docs/migration-plan.md](migration-plan.md) を参照。本ドキュメントは新方針・新実装に基づく最新の状態。

## 0. 目的

Proxmox VE運用に関するタスク(障害調査・構成変更・VM/LXCライフサイクル操作・監視/アラート設定・定期メンテナンス等)を、
Web UI経由でAIエージェントに任せられるようにする。自宅Proxmox VE(LXC構成)を対象とし、就活ポートフォリオとしてGitHub公開する。

### 実装状況(2026-09-02時点)

opencode移行(Phase 0〜5)が完了し、実機で一気通貫の動作を確認済み([docs/migration-plan.md](migration-plan.md)参照)。
`apps/web`の本番ビルド(`next start`)を実際に起動した状態で、タスク作成 → エージェント実行 → PVE write系ツール呼び出しで
opencodeのpermissionにより自動ブロック → Web UIの承認API経由で承認 → 実際にツールが実行される → `audit_log`に決定が
記録される、という流れをHTTP経由で確認済み(PVE本体は未接続のためツール実行自体は失敗するが、承認フロー・実行トリガー・
監査記録はすべて正しく機能することを確認した)。`audit_log.arguments`が記録されない不具合も修正・再検証済み。

未検証・既知の課題:
- 実PVE環境への接続(引き続き未検証)
- APIキー課金の実プロバイダー(Anthropic/OpenAI等)での動作確認(無料モデルopencode/big-pickleで代用確認)
- `apps/web`に認証・アクセス制御なし(単一ユーザーのホームラボ用途として意図的に省略)

## 1. 全体構成(opencode採用後)

```
┌─────────────┐   SSE/HTTP    ┌──────────────────────┐        ┌───────────────────┐
│   Web UI     │◄──────────────┤  apps/web (Next.js)   │  HTTP  │  opencode server   │
│ (Browser)    │───────────────►│  = フロントエンド     │───────►│ (`opencode serve`  │
└─────────────┘   REST         │  + BFF                │  SDK   │  子プロセスとして   │
                                 └──────────┬────────────┘        │  自動起動)         │
                                            │instrumentation.ts    └─────────┬──────────┘
                                            │で起動・event監視                │ MCP
                                            ▼                                │(stdio, opencode.json)
                                  packages/db (共有SQLite)          ┌─────────┴─────────┐
                                  tasks / audit_log(承認履歴)        │                    │
                                                                     ▼                    ▼
                                                           apps/mcp-proxmox        apps/mcp-tasks
                                                         (risk tierメタデータ、       (タスク管理)
                                                          実行ブロックはopencode委譲)
                                                                     │
                                                                     ▼
                                                              Proxmox VE クラスタ
```

`apps/web`はopencodeの**クライアント**であり、AIプロバイダーとの通信・パーミッション判定・セッション管理・
MCPツール呼び出しの仲介は全てopencode serverが担う。`apps/web`自身が保持する状態は、タスク管理(`tasks`)と
承認の**履歴**(`audit_log`)のみで、承認待ち状態そのもの(pending/approved)の真実はopencodeのpermission APIが持つ。

## 2. コンポーネントの責務

### 2.1 apps/web (Next.js: フロントエンド + BFF)

**UI構成(2026-09-02 チャット中心の1画面構成に刷新)**: ダッシュボード・タスク詳細・承認キューを別ページに
分けていた旧構成をやめ、Claude Code/claude.aiのような「左サイドバー(タスク一覧 + 承認キュー件数) + メイン
(選択中タスクとの会話ビュー)」構成にした。承認プロンプト(write/destructiveツールのask)も別ページの
承認キューではなく、会話の中にインラインのカードとして表示し、その場で承認/却下できる。配色・フォントは
opencode公式Web UI(`opencode web`)を実機で調査し、実際に使われているCSSカスタムプロパティ(背景ほぼ黒
`#080808`、ブランドカラーのオレンジ`#e27618`、ニュートラルグレーのボーダー、Interフォント)を参考値にした
(`apps/web/app/globals.css`)。この過程で、opencode自身のWeb UIはiframeで技術的には埋め込み可能(CSP/
X-Frame-Optionsのブロックなし)なことも実機確認したが、クロスオリジンのため中のUIをカスタマイズできず、
タスクのメタデータ(種別・優先度)や監査ログとの統合もできないため、埋め込みではなく自前実装を選んだ。

会話は`session.messages()`(opencodeの会話履歴API)・`audit_log`(過去の承認決定)・`task_comments`を
`apps/web/lib/chat-entries.ts`で共通の`ChatEntry`形式に変換し、初回表示とライブのSSEイベントを同じ見た目で
描画する(`components/TaskChatView.tsx`)。旧UIにあった「コメントを追加する」独立した入力欄は、チャット中心の
体験に合わせて主要な入力欄(常にエージェントへの発話)に一本化し、UIからは省いた
(`task_comments`テーブル・API自体は残しており、過去のコメントは会話内に表示される)。

- `instrumentation.ts`のNext.js起動フックで以下を行う:
  1. `opencode serve`を子プロセスとしてspawnし、ヘルスチェックで起動完了を待つ
  2. `@opencode-ai/sdk`の`createOpencodeClient`でクライアントを初期化(シングルトン)
  3. `client.event.subscribe()`をバックグラウンドで購読し続け、permission関連イベント(承認要求・決定)を
     `audit_log`テーブルに記録する常駐処理を開始する
- 「タスクを依頼する」操作を受けて、タスクに紐づく`opencodeSessionId`があれば再利用、なければ新規セッションを
  作成して`client.session.prompt()`を呼ぶ。イベントストリームをSSEでブラウザへ中継する
- 承認キュー(`GET /api/permissions`)はopencodeの`GET /permission`をそのままプロキシする(自前DBに
  pending状態を持たない)。承認/却下(`POST /api/permissions/:id/reply`)は`POST /permission/{requestID}/reply`を
  呼ぶだけで、セッション再開のための自前ロジックは不要(opencode側でセッションが継続する)。**`@opencode-ai/sdk`
  (1.18.25時点)はpermission系のオペレーションをクライアントの便利メソッドとしてラップしていないため、
  `apps/web/lib/opencode-permissions.ts`でOpenAPI仕様から確認した生のHTTPエンドポイントを直接叩いている**
- **PVE APIやAIプロバイダーの認証情報そのものは保持しない**

### 2.2 opencode server(`opencode serve`)
外部プロジェクト。詳細は https://github.com/anomalyco/opencode 、公式ドキュメント https://opencode.ai/docs/ 。
このプロジェクトにとっての役割は以下:

- **マルチプロバイダー抽象化**: Claude/OpenAI/Gemini等、`opencode.json`の`provider`設定で選んだモデルに対して
  プロンプトを送る。認証はプロバイダーごとのAPIキー、またはOAuth(Claude Pro/Maxは非公式)
- **MCPクライアント**: `opencode.json`の`mcp`設定に登録した`apps/mcp-proxmox`/`apps/mcp-tasks`をstdioで起動し、
  ツールとして各セッションに公開する(ツール名は`{server名}_{tool名}`で自動採番される)
- **パーミッション制御**: `permission`設定(`allow`/`ask`/`deny`、globパターン)に基づき、ツール呼び出しを
  自動実行するか、ユーザー承認を待ってブロックするか、拒否するかを判定する。`ask`判定されたツール呼び出しは
  サーバー内部で`Deferred`により一時停止し、`permission.asked`相当のイベントを発行、`client.permission.reply()`が
  呼ばれるまで再開しない
- **agent機能**: 複数のエージェント定義(異なるパーミッション・ツール制限を持つ)を切り替えられる。
  本プロジェクトでは`investigator`(read専用、write/destructiveは`deny`)・`operator`(write/destructiveは`ask`)の
  2エージェントを定義し、タスクの種類(読み取りのみ/書き込みを伴う)に応じて`apps/web`が選択する
  (詳細は3節)
- **セッション管理**: 会話(セッション)はサーバー側で継続的に保持される。`apps/web`は`session.prompt()`を
  同じ`session.id`に対して繰り返し呼ぶだけで会話を継続でき、CLIサブプロセスの再起動やresumeフラグの
  自前実装は不要になる

**認証について**: APIキー課金を基本方針とする。Claude Pro/Maxサブスクリプションのopencode経由利用は
Anthropicの公式サポート外(非公式プラグイン頼み、ToS上グレー)と判明したため、デフォルトにはせず、
READMEにリスクを明記した上でのオプトイン機能としてのみ用意する(docs/adr/0001参照)。

**組み込みツールの扱い**: opencodeは本来「プロジェクトディレクトリ内のコーディングエージェント」であり、
bash/edit/write/read等の組み込みツールを持つ。本プロジェクトの用途(Proxmox運用)ではこれらを
`permission`設定で全て`deny`し、MCPツールのみに利用を限定する。

### 2.3 apps/mcp-proxmox (Proxmox MCPサーバー)
- Proxmox VE REST APIを叩くツール群を提供
- ツールごとに risk tier(`read` / `write` / `destructive`)をツール定義本体(コード)に持たせる。これは
  **opencode側の`permission`設定を生成する根拠**、および**UI上のバッジ・警告表示の強度**として使う
  (opencode自体は3値(`allow`/`ask`/`deny`)しか区別しないため、`write`と`destructive`はどちらも`ask`に
  マップされるが、UIでは異なる強度の確認を出す)
  - **fail-closed原則**: 何らかの理由でtierが解決できないツールは、opencode設定側で`deny`にマップする
    (未知のツールを自動許可しない)
- PVE API tokenは専用の制限されたPVEロールを持つトークンを使う。risk tierによる階層化は、あくまでPVE側ACLの
  上に重ねる多層防御(defense-in-depth)であり、PVE側ACL設定の代替にはしない
- **実行ブロックのロジックは持たない**(旧設計にあった`approval-gate.ts`・`approval_check`ツールは撤去する)。
  ツールが呼ばれた時点でopencode側の`ask`判定は既に完了しているため、mcp-proxmoxのツールはPVE APIを
  直接呼び出すだけのシンプルな実装になる

### 2.4 apps/mcp-tasks (タスク管理MCPサーバー)
- `task_create` / `task_list` / `task_get` / `task_update` / `task_add_comment` / `task_link` などのツールを提供
- 会話履歴とは独立にSQLiteへ永続化。どのAIプロバイダー(opencodeが対応する任意のモデル)からも同一インターフェースで
  操作できる
- 調査中にエージェントが見つけた要対応事項も同じツールでタスク化できる(`origin: "agent"`、`source_task_id`で
  発生元タスクを追跡)
- opencode移行による変更はない。`opencode.json`の`mcp`設定に登録するだけで動作することを実機確認済み

### 2.5 packages/db (共有データ層)
- Drizzle ORM + SQLite(WALモード)。`mcp-tasks`と`apps/web`のBFFが同一DBファイルを参照する
  (`mcp-proxmox`は承認状態を持たなくなったためDB依存自体を削除した)
- 主要テーブル:
  - `tasks`: id, title, description, type, status, priority, origin, source_task_id, tags, opencode_session_id, created_at, updated_at
  - `task_comments`: id, task_id, author, body, created_at
  - `audit_log`(旧`approvals`から縮小): id, task_id, tool_name, arguments_json, risk_tier, decision(approved/rejected),
    decided_by, decided_at, created_at。**pending状態やexecuted_at・result_jsonは持たない**(実行結果の真実は
    opencode/PVE側にあり、ここは決定の履歴記録のみ)

## 3. パーミッション・承認モデル(opencodeへの委譲)

risk tierの3分類(read/write/destructive)という考え方自体は維持しつつ、実際の強制はopencodeの`permission`設定に
委譲する。

### opencode.json 設定イメージ

```jsonc
{
  "mcp": {
    "mcp-proxmox": { "type": "local", "command": ["node", "<dist>/mcp-proxmox/server.js"], "environment": { "...": "..." } },
    "mcp-tasks":   { "type": "local", "command": ["node", "<dist>/mcp-tasks/server.js"],   "environment": { "...": "..." } }
  },
  "tools": { "bash": false, "edit": false, "write": false, "read": false },
  "permission": {
    "*": "deny",
    "mcp-proxmox_pve_get_*": "allow",
    "mcp-proxmox_pve_list_*": "allow",
    "mcp-proxmox_pve_vm_start": "ask",
    "mcp-proxmox_pve_vm_shutdown": "ask",
    "mcp-proxmox_pve_vm_stop": "ask",
    "mcp-proxmox_pve_vm_delete": "ask",
    "mcp-tasks_*": "allow"
  },
  "agent": {
    "investigator": { "permission": { "mcp-proxmox_pve_vm_*": "deny" } },
    "operator": {}
  }
}
```

- `permission`のグローバル既定を`"*": "deny"`にすることで、旧設計のfail-closed原則(未定義tierはdestructive扱い)を
  踏襲する
- `investigator`エージェントはwrite/destructiveツールをそもそも`deny`にすることで、「読み取りのみタスク」を
  選んだ場合はUIの制約だけでなくopencode側でも物理的に書き込み不能にする(2重の防御)
- `operator`エージェントはグローバル設定(write/destructiveは`ask`)をそのまま使う

### 承認フロー(opencode委譲後)

1. エージェントが`ask`判定のツール(例: `mcp-proxmox_pve_vm_stop`)を呼ぶ
2. opencode serverがサーバー内部で実行をブロックし、`permission.asked`イベントを発行する
3. `apps/web`はバックグラウンドで購読している`event.subscribe()`からこのイベントを検知し、承認待ちとしてUIに表示する
   (加えて、UIの承認キューは`client.permission.list()`を都度呼んでライブの一覧を取得することもできる)
4. ユーザーがWeb UIで承認/却下すると、`apps/web`は`POST /permission/{requestID}/reply`(`{reply: "once"|"reject"}`)を呼ぶ
5. opencode serverがブロックを解除し、承認なら実際にPVE APIを実行、却下ならエージェントにエラー相当を返す。
   セッションは中断されないため、**自前のresume処理は不要**
6. `apps/web`のバックグラウンド購読処理(`instrumentation.ts`)が`permission.replied`イベントを検知し、`audit_log`に
   「誰が・いつ・何を・どう決定したか」を記録する

✅ この節の(1)〜(6)は実機で一気通貫に検証済み(docs/migration-plan.md Phase 5)。ただし`@opencode-ai/sdk`の型定義には
`permission.asked`イベント自体が定義されておらず、`permission.replied`の型も実際のプロパティ名
(`sessionID`/`requestID`/`reply`)と型定義上の名前(`sessionID`/`permissionID`/`response`)が一致しないことが判明した。
型を信用せず、実機で観測した実際のペイロード形状を手書きの型として使っている(`apps/web/instrumentation.ts`参照)。

## 4. タスク永続化: SQLite

opencode移行後も変更なし。

| 選択肢 | 評価 |
|---|---|
| **SQLite(採用)** | ファイル1つで運用完結。single-host/single-userのホームラボ用途に十分な性能。WALモードで複数プロセスからの同時アクセスも問題ない。バックアップはファイルコピーで済む |
| Postgres | 複数ユーザー・高頻度書き込み・将来のクラウド分散配置を見据えるなら妥当だが、home lab single-userには過剰 |
| ファイルベース(JSON/YAML) | 複数プロセスが同時に読み書きする用途にはロック機構を自前実装する必要があり不向き |

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
  opencodeSessionId?: string; // このタスクに対応するopencodeセッション(1タスク=1セッションが基本)
  createdAt: string;
  updatedAt: string;
}
```

タスク種別(`type`)は、Web UIが「エージェント実行時にどのopencode agentを使うか」を決めるヒントとしても使う
(例: `incident`はデフォルトで`investigator`、`change`/`maintenance`はデフォルトで`operator`。ユーザーが
明示的に切り替えられるようにする)。

## 6. Proxmox VE 権限モデル(risk tier例)

| tier | 例 | opencodeのpermission | UI表示 |
|---|---|---|---|
| `read` | ノード/VM/LXC状態取得、ログ取得、設定参照、バックアップ一覧 | `allow` | 通常表示 |
| `write` | VM/LXC起動停止・再起動、スナップショット作成、設定変更(CPU/メモリ)、ファイアウォールルール変更 | `ask` | 承認待ちバッジ(黄) |
| `destructive` | VM/LXC削除、スナップショット削除、ストレージ削除、ディスク縮小、クラスタ離脱 | `ask`(`investigator`エージェントでは`deny`) | 承認待ちバッジ(赤、強い警告文言) |

## 7. 未確定・今後確認が必要な事項

opencode Phase 0検証で判明・解決したこと(記録として残す):

- `opencode serve`の設定ファイル検出は**cwd起点**(`--config`のようなフラグは存在しない)。実機確認済み
- パーミッション応答は`POST /permission/{requestID}/reply`(`{reply: "once"|"always"|"reject"}`)。SDKに
  便利メソッドがないため生のHTTPを叩く(2.1節参照)。実機確認済み
- パーミッション一覧は`GET /permission`(全セッション横断、pendingのみを返す)。実機確認済み。
  セッションID/タスクIDでの絞り込みは`apps/web`側で行っている(`app/api/permissions/route.ts`)
- MCPツール名の自動採番規則は`{server名}_{tool名}`。実機確認済み

引き続き未検証・未実装の事項:

- 実PVE環境への接続(開発環境にProxmox実機がないため)
- APIキー課金の実プロバイダー(Anthropic/OpenAI等)での動作確認(無料モデルopencode/big-pickleで代用確認したのみ)
- opencodeのバージョン追従方針(活発に開発中のOSSで、破壊的変更が起きうる。`package.json`で`1.18.25`に固定済みだが、
  更新時は都度Phase 0相当の実機確認が必要)
- ライセンス選定(現状README/LICENSEはMITを仮置き。変更の余地あり)
- 認証・アクセス制御は未実装(単一ユーザーのホームラボ用途を前提に省略。将来のセットアップウィザード導入時に
  セットで設計する。CLAUDE.md「将来的な拡張方針」参照)

### 実装時に行った判断

- `tsconfig.base.json`の`exactOptionalPropertyTypes`は当初trueにしていたが、zodの`.optional()`推論型との相性が悪く
  (値がundefinedのプロパティを許容できない)全体で頻発するため無効化した。`strict`/`noUncheckedIndexedAccess`は維持
- TypeScriptは`5.9.3`を採用(`npm view typescript version`時点の最新は`7.0.2`だが、ネイティブ移植版でエコシステム
  互換性が未成熟なため見送った)
- SQLiteドライバは`drizzle-orm`が`node:sqlite`向けドライバを提供していなかったため`better-sqlite3`を採用
  (このホストでは追加のビルドツールなしにネイティブバインディングが解決できることを確認済み)
- Windows(Git Bash)からNode子プロセスへパスを渡す際、POSIXスタイル(`/c/Users/...`)だと接続が失敗する
  (`C:/Users/...`形式にする必要がある)。Node自身が`import.meta.url`等から組み立てるパスはこの問題に該当しない
- 旧設計の承認ゲート(compare-and-swapによる冪等実行、失敗時の結果記録)は実機テストで正しく動作することを
  確認済みだったが、opencodeが同種の機構を標準搭載していると判明したため撤去した(docs/adr/0001参照)
- `opencode-ai`(bin実行ファイルのみのパッケージ)のバイナリパス解決に当初`import.meta.resolve()`を使っていたが、
  Turbopackのサーバーバンドル(`next start`)で`Q.resolve is not a function`という実行時エラーを起こすことが
  判明した。`process.cwd()`起点の`node_modules`探索に切り替えて解決した(`apps/web/lib/opencode-server.ts`参照)。
  Next.js(Turbopack)配下では`import.meta.resolve`のようなあまり一般的でない動的ESM APIは、ビルド後の実際の
  起動まで確認しないと壊れていることに気づけない、という教訓
