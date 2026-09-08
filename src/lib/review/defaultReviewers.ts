/**
 * プロジェクトごとの「既定の承認者」。
 *
 * 社内承認を依頼するたびに同じ人を選び直すのは手間なので、プロジェクト設定
 * (spaces.default_reviewer_ids) に持たせ、承認者を選ぶ画面で最初から
 * チェックが付いた状態にする。設定は「毎回の初期値」であって固定ではなく、
 * その場で足したり外したりできる。
 */

/**
 * 既定の承認者のうち、いま実際に依頼できる人だけを残す。
 *
 * 設定した人がスペースを抜けたり、依頼者本人だったりすると依頼先にできないため、
 * 呼び出し側が渡す「選べるメンバー」と突き合わせて落とす。
 * 設定した順番は保つ（並びが毎回変わると選び直したくなるため）。
 */
export function resolveDefaultReviewerIds(
  defaultReviewerIds: readonly string[] | null | undefined,
  selectableIds: readonly string[]
): string[] {
  if (!defaultReviewerIds || defaultReviewerIds.length === 0) return []
  const selectable = new Set(selectableIds)
  const seen = new Set<string>()
  const resolved: string[] = []

  for (const id of defaultReviewerIds) {
    if (!selectable.has(id) || seen.has(id)) continue
    seen.add(id)
    resolved.push(id)
  }
  return resolved
}

/**
 * 「デフォルト承認者」チェックの付け外しを反映した新しい一覧を返す。
 * 元の配列は書き換えない（楽観更新で前の値に戻せるようにするため）。
 */
export function toggleDefaultReviewer(
  defaultReviewerIds: readonly string[] | null | undefined,
  userId: string,
  isDefault: boolean
): string[] {
  const current = defaultReviewerIds ?? []
  if (!isDefault) return current.filter((id) => id !== userId)
  if (current.includes(userId)) return [...current]
  return [...current, userId]
}
