/**
 * アカウントの「APIキー」一覧に出す「使えるプロジェクト」。
 * プロジェクト設定で作ったキー（scope=space）も、持ち主を記録するようになってこの一覧に並ぶ。
 * そのキーは allowed_space_ids が空なので、そのまま扱うと「全スペース」と誤表示される。
 */
export interface KeySpaceScope {
  scope: 'space' | 'org' | 'user'
  space_id: string | null
  allowed_space_ids: string[] | null
}

/**
 * 選んだIDの集合が、渡されたプロジェクト全部の集合とちょうど一致するか（重複・順序は問わない）。
 * 件数の一致だけで見ると、渡す一覧の中身（アーカイブ済みを含める・所属が変わる等）が
 * 変わったときに、たまたま件数が揃っただけで「全部」と誤って出てしまう
 */
function isEverySpace(ids: string[], spaces: ReadonlyArray<{ id: string }>): boolean {
  if (spaces.length === 0) return false
  const idSet = new Set(ids)
  const spaceIdSet = new Set(spaces.map((s) => s.id))
  if (idSet.size !== spaceIdSet.size) return false
  for (const id of idSet) {
    if (!spaceIdSet.has(id)) return false
  }
  return true
}

export function describeKeySpaces(key: KeySpaceScope, spaces: ReadonlyArray<{ id: string; name: string }>): string {
  if (key.scope === 'space') {
    const name = spaces.find((s) => s.id === key.space_id)?.name
    return `${name ?? '1つのプロジェクト'}のみ（プロジェクト設定で発行）`
  }
  const ids = key.allowed_space_ids
  if (!ids || ids.length === 0 || isEverySpace(ids, spaces)) return '全スペース'
  const names = ids
    .map((id) => spaces.find((s) => s.id === id)?.name)
    .filter(Boolean)
    .slice(0, 2)
  return ids.length > 2 ? `${names.join(', ')} 他${ids.length - 2}件` : names.join(', ')
}
