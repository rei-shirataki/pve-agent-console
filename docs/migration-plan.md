# opencode移行 作業計画

背景・決定事項は [docs/adr/0001-adopt-opencode.md](adr/0001-adopt-opencode.md) を参照。

**状態(2026-09-01時点): Phase 0〜5すべて完了・実機検証済み。** 以下、各Phaseで実際に分かったこと・
変更したことを記録として残す。

## Phase 0: 調査・実機検証 ✅

- [x] `opencode serve`を実際に起動し、`@opencode-ai/sdk`から接続してセッション作成・`session.prompt()`が動くこと
      → 確認済み。`opencode/big-pickle`(APIキー不要の無料モデル)で疎通
- [x] `apps/mcp-tasks`を`opencode.json`の`mcp`に登録し、ツールとして認識されること
      → 確認済み。ツール名は`{server名}_{tool名}`(例: `mcp-tasks_task_list`)
- [x] `permission: {"...": "ask"}`設定でツール呼び出しが実際にブロックされ、`event.subscribe()`で
      `permission.asked`イベントが受け取れること、`client.permission.reply()`で再開できること
      → 確認済み。ただし**SDKの型定義には`permission.asked`イベント自体が定義されておらず**、
      `permission.replied`の型も実際のプロパティ名(`requestID`/`reply`)と定義(`permissionID`/`response`)が
      一致しない。型を信用せず実機で観測した実際のペイロード形状を手書きの型として使うことにした
      (`apps/web/instrumentation.ts`参照)
- [x] `opencode serve`にカスタム設定ファイルの場所をどう伝えるか
      → `--config`フラグは存在しない。**cwd起点で`opencode.json`を自動検出する**ことを確認
- [x] `client.permission.list()`の挙動 → SDKには`permission`名前空間の便利メソッドが存在しなかったため、
      OpenAPI仕様(`GET {baseUrl}/doc`)から確認した生のHTTPエンドポイント(`GET /permission`,
      `POST /permission/{requestID}/reply`)を直接叩く方式にした(`apps/web/lib/opencode-permissions.ts`)
- [x] APIキー課金での実プロバイダー呼び出し → 無料モデルで代用して確認(実際のAPIキー課金プロバイダーでの
      確認は未実施。プロバイダー切り替え自体は`OPENCODE_PROVIDER_ID`/`OPENCODE_MODEL_ID`で対応)

## Phase 1: packages/db スキーマ改修 ✅

- [x] `tasks`に`opencode_session_id`を追加
- [x] `approvals`テーブルを廃止し、`audit_log`テーブル(決定履歴のみ)に一本化
- [x] `TaskRepository`に`getTaskByOpencodeSessionId`/`setOpencodeSessionId`を追加、
      `ApprovalRepository`を`AuditLogRepository`に置き換え
- [x] `packages/shared-types`の`agent-event.ts`/`approval.ts`を削除、`audit-log.ts`を新設

## Phase 2: apps/mcp-proxmox 簡略化 ✅

- [x] `approval-gate.ts`・`approval_check`ツールを削除。各ツールは直接実行するだけになった
- [x] `packages/db`/`drizzle-orm`への依存自体を削除(承認状態を持たなくなったため不要に)
- [x] 実機スモークテスト済み(MCPクライアントから直接呼び出し、read/writeツールが動作することを確認)

## Phase 3: apps/web への opencode 統合基盤 ✅

- [x] `lib/opencode-config.ts` / `lib/opencode-server.ts` / `lib/opencode-client.ts` / `lib/opencode-permissions.ts`
- [x] `instrumentation.ts`でopencode serve起動 + permissionイベント購読 → `audit_log`記録
- [x] `packages/agent-adapters`を削除、`lib/orchestrator.ts`・`lib/mcp-config.ts`を削除
- [x] ⚠️ **`import.meta.resolve()`でopencode-aiバイナリを解決する実装は、Turbopackのサーバーバンドルで
      `Q.resolve is not a function`エラーを起こすことが実機で判明**(`next start`実行時)。
      `process.cwd()`起点の`node_modules`探索に変更して解決した(`lib/opencode-server.ts`参照)

## Phase 4: Web UI 作り直し ✅

- [x] `app/api/agent/run/route.ts`: `session.create`(初回のみ)+`session.promptAsync` + イベントストリームの
      SSE中継に書き換え。セッションIDは`tasks.opencode_session_id`に保存して再利用するため、
      手動resumeボタン・`resumeSessionId`ロジックは完全に不要になった
- [x] `app/api/permissions/**`: `client.permission.list()`/`reply()`相当をプロキシ
- [x] `TaskDetailClient.tsx` / `ApprovalQueueClient.tsx`: 新API・新イベント形式に対応
- [x] `app/api/audit-log/route.ts`(全体の承認履歴) / `app/api/tasks/[id]/audit-log/route.ts`(タスク別)を追加
- [x] 変更不要だった部分(想定通り): ダッシュボード、`CreateTaskForm`、タスクCRUD API、`globals.css`、`layout.tsx`

## Phase 5: エンドツーエンド検証 ✅

実際にブラウザ相当のHTTPクライアントから、本番ビルド(`next start`)を起動した状態で以下を確認済み:

1. タスク作成 → `POST /api/agent/run`でエージェント実行 → 実際に`mcp-proxmox_pve_vm_start`
   (writeツール)を呼び出し
2. `permission.asked`イベントがSSE経由でブラウザ側に届く
3. `GET /api/permissions`に、正しく`taskId`(sessionID経由で逆引き)・`riskTier`付きで一覧表示される
4. `POST /api/permissions/:id/reply`で承認 → pendingから消える
5. 承認後、実際にPVE API呼び出しが実行される(ダミーURLのため`fetch failed`で失敗するが、
   実行されたこと自体・エージェントがその結果をユーザーに報告することを確認)
6. `GET /api/tasks/:id/audit-log`に決定が記録される(`decision: "approved"`、`riskTier: "write"`等)

**2026-09-02修正済み**: 監査ログの`arguments`列が`null`のまま記録される既知の問題があったが、原因は
`instrumentation.ts`で`toolInputs`から値を**削除してから読み取っていた**単純な順序ミスだった(先にget、
その後にdelete、に修正)。実機で`{"node":"pve1","vmid":102}`のように実引数が正しく記録されることを再検証済み。

## Phase 6(将来。今回のスコープ外、設計メモのみ)

CLAUDE.mdの「将来的な拡張方針」に記載。実装はしない。
