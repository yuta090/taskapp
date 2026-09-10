/**
 * プロジェクトの APIキー（発行・一覧・削除）を扱えるか。組織の owner とそのプロジェクトの admin だけ。
 * プロジェクト設定「API設定」の画面が見せている条件（管理者限定）と同じ条件を、サーバーでも使う。
 * 削除だけは、自分が作ったキーなら役割に関係なくできる（呼び出し側で判定する）。
 */
export function canManageSpaceKeys(
  orgRole: string | null | undefined,
  spaceRole: string | null | undefined,
): boolean {
  return orgRole === 'owner' || spaceRole === 'admin'
}
