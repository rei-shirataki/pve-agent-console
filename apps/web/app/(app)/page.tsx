import CreateTaskForm from "@/components/CreateTaskForm";

export const dynamic = "force-dynamic";

export default function NewTaskPage() {
  return (
    <div className="app-main-inner">
      <h1>新しいタスク</h1>
      <p className="muted">
        障害調査・構成変更・定期メンテナンス・その他のタスクを作成すると、専用の会話画面に移動します。
      </p>
      <div className="card">
        <CreateTaskForm />
      </div>
    </div>
  );
}
