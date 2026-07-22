/**
 * 汎用PATCH(/api/integrations/connections/[id]/import-config)では絶対に更新しない
 * import_config のサーバ管理フィールド。
 *
 * これらは「サーバがライブスキーマを再取得して検証した結果」(notion_mappings/kintone_mappings)、
 * または「アプリIDとAPIトークンをセットで登録する専用経路」(kintone_app_ids・kintone_app_tokens)
 * でしか作れない確定データ。汎用PATCHから触れると次の3事故が起きる:
 *   (a) 保存APIの検証を迂回して実在しない prop_id / フィールドコードを永続化できてしまう
 *       （＝「設定済みに見えるのに取り込みが止まる」状態を作れる）
 *   (b) 別項目(target_space_id等)を変えただけで確定済みマッピングが丸ごと消える
 *   (c) kintone_app_tokens固有: ImportConfigEditor.tsx等が現在のimport_config全体を
 *       スプレッドして送るパターン(既存の実装パターン)により、target_space_id変更のような
 *       無関係な操作が、その時点でクライアントが持っていた(古いかもしれない)
 *       kintone_app_tokensをそのまま送り返し、並行して走ったアプリ追加/削除
 *       (rpc_kintone_apps_add/remove)の結果を上書きして消してしまう(lost update)
 *
 * ⚠ 同じキー集合が SQL 側にも現れる(20260723014852_kintone_apps_merge_rpc.sql の
 * c_server_managed_keys。kintone_app_tokens 追加に伴い、この配列を持つ関数定義自体は
 * 20260722233711_import_config_merge_rpc.sql から同ファイルへ create or replace で
 * 上書き・移設した)。片方だけ増やすと守れていないキーが静かに生まれるため、
 * mappingDbGuards.test.ts で両者の一致を回帰として固定している。
 * ルート側ではなくここ(lib)に置くのは、Next.js の route ファイルがハンドラ以外を
 * export できないため（テストから参照できるようにする）。
 */
export const IMPORT_CONFIG_SERVER_MANAGED_KEYS = [
  'notion_mappings',
  'kintone_mappings',
  'kintone_app_ids',
  'kintone_app_tokens',
] as const

/**
 * import_config の PATCH ペイロードを整える関数。
 *
 * ConnectorSyncPane.tsx(gtasks/multica等の一覧トグル) と NotionImportPanel.tsx(Notion取り込み
 * ウィザードの一覧トグル) の両方から使う小さな共有ロジックのため、どちらのコンポーネントにも
 * 属させずここ(lib)へ切り出す。将来 NotionImportPanel を動的読み込み(code splitting)にしたときに
 * ConnectorSyncPane.tsx という大きなモジュール一式を巻き込んで import してしまわないようにする
 * ためでもある(このファイル自体はUIを持たない純粋関数のみ)。
 *
 * ⚠ サーバ側は**部分更新**になった(rpc_import_config_merge /
 * 20260722233711_import_config_merge_rpc.sql)。セマンティクスは:
 *   - 送ったキーだけを更新する
 *   - **送らなかったキーは現在値のまま残る**
 *   - 値が null のキーは「未設定に戻す」＝DB上からキーを削除する
 * そのため「空文字/空配列＝未設定」を **キーごと削除して送る** 旧方式は使えない
 * (削除して送ると「未設定にしたい」が「現在値を維持」に化け、解除操作が永久に反映されない)。
 * 未設定は **明示的な null** で送る。DB上の形は従来どおり「キーが無い＝未設定」で変わらない。
 *
 * ⚠ read_container_ids だけは例外(空配列でも null に変換せずそのまま送る)。
 * 「取り込み対象を全解除したい」は「キーを削除する(未設定)」ではなく「空配列という値にする」で
 * 表現する契約であり、空配列に意味があるキーだからである(実際に踏んだ罠なのでここに残す)。
 * 他のキー(target_space_id/read_list_ids/default_assignee_id等)は空文字/空配列＝未設定という
 * 契約のままなので null に変換する(「空配列に意味があるキー」と「無いキー」の違い)。
 * 取り込み対象コンテナのON/OFFトグルはこの関数を経由して呼ぶこと。
 */
/**
 * import_config のうち、クライアント（ブラウザ）へは絶対に返してはならないキー。
 *
 * ⚠ IMPORT_CONFIG_SERVER_MANAGED_KEYS（クライアントから**書けない**が**表示は必要**なキー。
 * kintone_app_ids はUIがアプリ一覧を描く正本、kintone_mappings/notion_mappings は
 * KintoneAppsPanel/NotionImportPanel の「設定済み/未設定」バッジの正本）とは**別概念**。
 * IMPORT_CONFIG_SERVER_MANAGED_KEYS を流用してAPI応答からも消すと、上記のUIが壊れる
 * （事故の実例: kintone_app_tokensを塞ぐついでにkintone_app_idsまで消すと、KintoneAppsPanel が
 * 「登録済みアプリが無い」ように見えてしまう）。
 *
 * ここに載るのは「暗号化済みであっても平文と同じ扱いで守るべき秘密そのもの」だけ:
 *   - kintone_app_tokens: app_id をキーにした、アプリ単位で個別に暗号化した kintone APIトークン
 *     の jsonb オブジェクト（暗号化列 access_token_encrypted に載るヘッダ用複合値の元データ）。
 *     暗号化されていても、復号鍵(SYSTEM_ENCRYPTION_KEY)が将来漏洩した場合に備え、平文が
 *     ブラウザ・React Queryのキャッシュ・devtoolsへ渡る経路をそもそも作らない（多層防御）。
 *
 * 接続一覧(GET /api/integrations/connections)・取り込み設定PATCH応答の**両方**が
 * sanitizeImportConfigForClient を必ず通す(1箇所に集約し、経路ごとに個別実装しない)。
 */
const IMPORT_CONFIG_CLIENT_PRIVATE_KEYS = ['kintone_app_tokens'] as const

/**
 * import_config をAPI応答としてクライアントへ返す前に必ず通すサニタイザ。
 * 呼び出し側の入力オブジェクトは変更しない（新しいオブジェクトを返す）。
 */
export function sanitizeImportConfigForClient(
  config: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {}
  const out: Record<string, unknown> = { ...config }
  for (const key of IMPORT_CONFIG_CLIENT_PRIVATE_KEYS) delete out[key]
  return out
}

export function normalizeImportConfigPatch(config: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...config }
  Object.keys(next).forEach((key) => {
    if (key === 'read_container_ids') return // 空配列でも値として保持する(上記コメント参照)
    const value = next[key]
    if (value === '' || value === undefined || (Array.isArray(value) && value.length === 0)) {
      // undefined は JSON.stringify で消えてしまい「送らなかった」＝現在値維持に化けるため、
      // 明示的な null(未設定)へ倒す。
      next[key] = null
    }
  })
  return next
}
