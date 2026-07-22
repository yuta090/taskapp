/**
 * import_config の空文字/空配列キーを送らない(≒未設定)ための整形関数。
 *
 * ConnectorSyncPane.tsx(gtasks/multica等の一覧トグル) と NotionImportPanel.tsx(Notion取り込み
 * ウィザードの一覧トグル) の両方から使う小さな共有ロジックのため、どちらのコンポーネントにも
 * 属させずここ(lib)へ切り出す。将来 NotionImportPanel を動的読み込み(code splitting)にしたときに
 * ConnectorSyncPane.tsx という大きなモジュール一式を巻き込んで import してしまわないようにする
 * ためでもある(このファイル自体はUIを持たない純粋関数のみ)。
 *
 * ⚠ read_container_ids だけは例外(空配列でも保持して送る)。サーバ側
 * (src/app/api/integrations/connections/[id]/import-config/route.ts のPATCH)は
 * 「キー自体が送られてこなければ現在値を保持し、キーがあれば(空配列でも)その値で上書きする」
 * という部分更新セマンティクスを持つ。read_container_ids を他のキーと同じく空配列で削除すると、
 * 「取り込み対象を全解除したい」という意図が「キーを送らなかった(＝現在値を維持)」に化けてしまい、
 * サーバ側が空配列送信と未送信を区別できず、全解除がいつまでも反映されない(実際に起きていた罠)。
 * 他のキー(target_space_id/read_list_ids/default_assignee_id等)は空文字/空配列＝未設定という
 * 契約のままなので、従来どおり削除する(「空配列に意味があるキー」と「無いキー」の違い)。
 * 取り込み対象コンテナのON/OFFトグルはこの関数を経由して呼ぶこと。
 */
export function pruneImportConfig(config: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...config }
  Object.keys(next).forEach((key) => {
    if (key === 'read_container_ids') return // 空配列でも保持する(上記コメント参照)
    const value = next[key]
    if (value === '' || value === undefined || (Array.isArray(value) && value.length === 0)) {
      delete next[key]
    }
  })
  return next
}
