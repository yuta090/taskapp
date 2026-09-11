/**
 * ポータル（相手先）の承認/修正依頼などが 409 で止まったとき、画面に出す文言を選ぶ。
 *
 * /api/portal/tasks/[taskId] は、業務ルールで止まっている場合（社内レビュー未完了・
 * 決定事項未決・見積もり確認待ちなど）は `reason: 'blocked'` を付けて具体的な理由を
 * 返す。本当に他の誰かが先に操作していた場合（楽観的ロックの競合）は理由を付けない
 * ため、その場合だけ呼び出し側が渡す既定の文言を使う。
 */
export function resolvePortalConflictMessage(
  data: { error?: string; reason?: string },
  fallback: string
): string {
  return data.reason === 'blocked' && data.error ? data.error : fallback
}
