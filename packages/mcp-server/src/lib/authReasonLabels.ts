/**
 * 権限の確認で断られた理由を、利用者に見せる決まった日本語にする。
 * #843 の状態ラベル（statusLabels.ts）と同じ形（言い換えを1か所に集約する）。
 */

export const AUTH_REASON_LABELS = {
  invalidOrExpiredApiKey: 'APIキーが無効か期限切れです',
  spaceIdRequired: 'spaceId の指定が必要です',
  spaceNotAllowed: 'このAPIキーで許可されたプロジェクトではありません',
  keyNotBoundToSpace: 'このAPIキーはどのプロジェクトにも紐づいていません',
  keyOwnerNotSet: 'このAPIキーに持ち主が設定されていません',
} as const

/** 例: 「Action "write" not allowed for this API key」に対応する断り文言 */
export function actionNotAllowedReason(action: string): string {
  return `このAPIキーでは操作「${action}」を実行できません`
}

/** 例: 「Tool "space_list" requires scope=org or scope=user (current: space)」に対応する断り文言 */
export function scopeRequiredReason(toolName: string, requiredScope: string, currentScope: string): string {
  return `ツール「${toolName}」は ${requiredScope} のAPIキーが必要です（現在のscope: ${currentScope}）`
}
