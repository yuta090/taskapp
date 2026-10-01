/**
 * 最後に開いたプロジェクトの保存キーと、起動後に開き直してよいかの判定（純粋・React/AsyncStorage 非依存）。
 * キーに userId を入れるのは、同じ端末で別の人がログインしたとき前の人の記録を使わないため。
 */

export const LAST_PROJECT_KEY_PREFIX = 'agentpm-last-project:'

export function lastProjectKey(userId: string, orgId: string): string {
  return `${LAST_PROJECT_KEY_PREFIX}${userId}:${orgId}`
}

/** 保存していた id が今の一覧にあるときだけ返す（アーカイブ・権限なしのプロジェクトは開かない） */
export function pickRestorableProject(projects: readonly { id: string }[], lastId: string | null | undefined): string | null {
  if (!lastId) return null
  return projects.some((p) => p.id === lastId) ? lastId : null
}
