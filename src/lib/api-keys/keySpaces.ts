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

export function describeKeySpaces(key: KeySpaceScope, spaces: ReadonlyArray<{ id: string; name: string }>): string {
  if (key.scope === 'space') {
    const name = spaces.find((s) => s.id === key.space_id)?.name
    return `${name ?? '1つのプロジェクト'}のみ（プロジェクト設定で発行）`
  }
  const ids = key.allowed_space_ids
  if (!ids || ids.length === 0 || ids.length === spaces.length) return '全スペース'
  const names = ids
    .map((id) => spaces.find((s) => s.id === id)?.name)
    .filter(Boolean)
    .slice(0, 2)
  return ids.length > 2 ? `${names.join(', ')} 他${ids.length - 2}件` : names.join(', ')
}
