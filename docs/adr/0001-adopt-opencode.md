# ADR 0001: AIバックエンドとしてopencodeを採用する

- Status: Accepted
- Date: 2026-08-31

## Context

初期設計(docs/architecture.md 初版)では、Claude Code / Gemini CLI / Codex CLIをそれぞれ`packages/agent-adapters`で
個別にラップし、共通の`AgentAdapter`インターフェースを自作していた。承認フロー(write/destructive操作の実行前承認)も
`apps/mcp-proxmox`内にfast-return + `approval_check` + compare-and-swapによる冪等実行を自作し、実機テストで
バグを発見・修正するところまで実装した(詳細はgit log参照)。

実装を進める過程で、以下の理由からこの自作範囲が本質的な価値を生んでいないことが分かった:

- マルチプロバイダー対応・MCP統合・パーミッション制御は、OSSのAIコーディングエージェント「opencode」
  (https://github.com/anomalyco/opencode, MIT License)が標準機能として提供している
- 特にopencodeの`permission`システムは、ツール呼び出しを`ask`設定でサーバー内部の`Deferred`によりブロックし、
  `permission.asked`イベントを発行、クライアントが`permission.reply()`を呼ぶまで待つ、という**自作した承認ゲートと
  ほぼ同じ目的の仕組み**を標準搭載している

## Decision

- AIプロバイダーとのやり取りは`packages/agent-adapters`を廃止し、opencodeのheadless server(`opencode serve`)+
  公式SDK(`@opencode-ai/sdk`)経由で行う。`apps/web`(Next.js)がopencode serverのクライアントという位置づけになる
- `apps/mcp-proxmox`・`apps/mcp-tasks`は自作のまま維持し、opencodeの`mcp`設定(`opencode.json`)に接続先として登録する
- 権限モデル(read/write/destructiveのrisk tier)は、opencodeのツール単位パーミッション(`allow`/`ask`/`deny`)と
  `agent`機能(investigator/operator)に可能な限り乗せ、自前で承認フローをフルスクラッチする範囲を最小化する
- 承認の「実行ブロック」の実体はopencodeに委譲する。自前の`approvals`テーブルは実行ブロックの機構としては廃止し、
  「誰が・いつ・何を承認/却下したか」を記録するだけの受動的な監査ログ(`audit_log`)に縮小して残す
- AIプロバイダーの認証・課金は、APIキー課金を基本としつつ、Claude Pro/Maxサブスクリプションの
  opencode経由利用(非公式・Anthropic ToS上グレー)もオプトインの選択肢としてドキュメント化する。
  公開ポートフォリオとしてのデフォルトにはしない
- `opencode serve`はNext.jsアプリ(`apps/web`)の起動時に`instrumentation.ts`から子プロセスとして自動起動する

## Consequences

- `packages/agent-adapters`全体、`apps/mcp-proxmox/src/approval-gate.ts`、Web UIの`AgentEvent`ストリーミング・
  手動セッション再開ロジックが不要になり削除する。実装量は正味で減る
- 一方で、opencodeという外部プロジェクトへの依存が増える。ドキュメントの記載が薄い箇所(permission応答APIの
  詳細仕様、MCPツールパーミッションの既知の不具合報告など)があり、実装前に実機検証が必須(docs/migration-plan.md
  のPhase 0参照)
- opencodeは本来「プロジェクトディレクトリ内のコーディングエージェント」であり、組み込みのbash/edit/write/read
  ツールを持つ。今回の用途(Proxmox運用)ではこれらを全てdenyし、MCPツールのみに限定する運用とする
- セッション管理・再開がopencode側に一本化されるため、タスクとopencodeセッションの対応を`tasks`テーブルに
  `opencodeSessionId`として保持する形にスキーマを変更する
