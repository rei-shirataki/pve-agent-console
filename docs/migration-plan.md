# opencode移行 作業計画

背景・決定事項は [docs/adr/0001-adopt-opencode.md](adr/0001-adopt-opencode.md) を参照。
本ドキュメントは実装セッションをまたいで進捗を追うための作業分解。**このセッションでは未着手**(調査・設計のみ)。

## Phase 0: 調査・実機検証(実装着手前に必須)

自作の承認ゲートを廃止してopencodeのpermission機構に置き換える前に、以下を実機で確認する
(ドキュメントの記載だけでは確証が持てなかった項目。docs/architecture.md 参照)。

- [ ] `opencode serve`を実際に起動し、`@opencode-ai/sdk`から接続してセッション作成・`session.prompt()`が動くこと
- [ ] `apps/mcp-tasks`(既存のビルド済みMCPサーバー)を`opencode.json`の`mcp`に登録し、`mcp-tasks_task_list`等が
      ツールとして認識されること
- [ ] `permission: {"...": "ask"}`設定でツール呼び出しが実際にブロックされ、`event.subscribe()`で
      `permission.asked`相当のイベントが受け取れること、`client.permission.reply()`で再開できること
- [ ] `opencode serve`にカスタム設定ファイルの場所をどう伝えるか(`--config`引数か、cwd起点か)
- [ ] `client.permission.list()`がセッション横断・セッションID絞り込みでどう振る舞うか
- [ ] (可能であれば)APIキー課金で最小の実プロバイダー呼び出しが通ること。サブスクリプションプラグインの検証は
      オプトイン機能のため後回しでよい

この段階で「ドキュメント記載と実際の挙動が異なる」ことが判明した場合、Phase 1以降の設計を先に見直すこと。

## Phase 1: packages/db スキーマ改修

- [ ] `tasks`に`opencode_session_id`(nullable text)を追加するマイグレーション
- [ ] `approvals`テーブルを「実行ブロックの実体」から「決定履歴の記録」に縮小
      (`executed_at`・`result_json`・CAS前提のロジックを撤去し、`decision`・`decided_by`・`decided_at`・
      `risk_tier`・`tool_name`・`arguments_json`・`task_id`のみの受動的な履歴レコードにする)
- [ ] `ApprovalRepository`を履歴追記専用に書き換え(「既に決定済みなら拒否」ガードのようなpending状態管理は
      opencode側の責務になるため不要になる)
- [ ] `packages/shared-types`の`agent-event.ts`を削除、`approval.ts`を新しいレコード形状に合わせて更新

## Phase 2: apps/mcp-proxmox 簡略化

- [ ] `approval-gate.ts`を削除
- [ ] 各ツールの`execute`を直接呼び出しに戻す(fast-return/pending_approvalラッパーを撤去)。
      `riskTier`フィールド自体は維持し、opencodeの`permission`設定生成の根拠として使う
- [ ] `approval_check`ツールを削除
- [ ] 実機で再度スモークテスト(MCPクライアントから直接呼び出して、read/writeツールが単純に動くことを確認)

## Phase 3: apps/web への opencode 統合基盤

- [ ] `lib/opencode-config.ts`: `opencode.json`を生成する処理(`mcp`定義、`permission`ルール、`agent`定義)。
      前回の`lib/mcp-config.ts`の設計思想(秘密情報はリポジトリ外に書く)を踏襲
- [ ] `lib/opencode-server.ts`: `opencode serve`をspawnし、ヘルスチェックしてbaseURLを返す
- [ ] `lib/opencode-client.ts`: `createOpencodeClient`のシングルトン
- [ ] `instrumentation.ts`: 上記2つを起動時に呼び出し、`event.subscribe()`を購読し続けるバックグラウンド処理を開始して
      permission関連イベントを`audit_log`に記録する
- [ ] `packages/agent-adapters`を削除、`lib/orchestrator.ts`を削除

## Phase 4: Web UI 作り直し(AI呼び出し関連のみ)

- [ ] `app/api/agent/run/route.ts`: `session.create`/`session.prompt` + 関連イベントのSSE中継に書き換え
      (タスクに紐づく`opencodeSessionId`があれば再利用、なければ新規作成して保存)
- [ ] `components/TaskDetailClient.tsx`: 新イベント形式への対応。手動resumeボタン・`resumeSessionId`ロジックを削除
      (opencode側でセッションが継続するため不要)
- [ ] `app/api/approvals/**` → `app/api/permissions/**`に置き換え、`client.permission.list()`/`reply()`を
      プロキシする実装に変更
- [ ] `components/ApprovalQueueClient.tsx` / `app/approvals/page.tsx`: 新APIに合わせてデータ取得部分を書き換え
      (見た目・バッジ等のデザインは流用)
- [ ] 変更不要: ダッシュボード、`CreateTaskForm`、タスクCRUD API、`globals.css`、`layout.tsx`

## Phase 5: エンドツーエンド検証

- [ ] ブラウザ操作で「エージェント実行 → askツール呼び出しでブロック → UIで承認 → 実行再開 → 結果表示」の
      一気通貫を確認
- [ ] `audit_log`に承認履歴が正しく記録されることを確認
- [ ] 可能であればPVE実機への接続確認(前回セッションから引き続き未検証)
- [ ] docs/architecture.md・README.mdを実装後の状態に更新

## Phase 6(将来。今回のスコープ外、設計メモのみ)

CLAUDE.mdの「将来的な拡張方針」に記載。実装はしない。
