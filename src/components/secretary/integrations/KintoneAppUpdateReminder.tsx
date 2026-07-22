'use client'

/**
 * kintone接続前後で共通の注意書き — 「APIトークンを生成しただけでは効かず、アプリ設定を
 * 運用環境に反映('アプリを更新')するまで動かない」ことを、失敗してから気づかせるのではなく
 * 入力欄の近くで先に案内する(client.ts の GAIA_IA02 判定・エラーメッセージと同じ事実を、
 * 事前案内としても出す。二重管理にならないよう文言はここ1箇所にまとめ、接続フォーム
 * (KintoneConnectPanel.tsx)とアプリ追加フォーム(KintoneAppsPanel.tsx)の両方から使う)。
 */
export function KintoneAppUpdateReminder() {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
      <p className="text-xs font-medium text-gray-700 mb-1">接続前に確認してください</p>
      <ol className="list-decimal list-inside text-[11px] text-gray-500 space-y-0.5">
        <li>kintoneでアプリの設定画面を開く</li>
        <li>「APIトークン」→「生成」</li>
        <li>必要な権限を選ぶ(レコード閲覧。完了を書き戻す場合は編集も)</li>
        <li className="font-medium text-gray-700">保存して「アプリを更新」を押す(これを忘れると接続できません)</li>
      </ol>
    </div>
  )
}
