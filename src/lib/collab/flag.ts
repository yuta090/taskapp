/**
 * 同時編集を開ける組織の入り口。
 *
 * 最初は自社とデモ組織だけで開ける（COEDITING_SPEC 6 の PR1）。列は足さず、環境変数で
 * 決める。値は組織IDをカンマで並べたもの。`*` を入れると全組織で開く。
 *
 * 例: NEXT_PUBLIC_COLLAB_MINUTES_ORG_IDS=00000000-0000-0000-0000-000000000001,<自社のID>
 */
const RAW = process.env.NEXT_PUBLIC_COLLAB_MINUTES_ORG_IDS ?? ''

function parseOrgIds(raw: string): Set<string> {
  return new Set(
    raw
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value !== '')
  )
}

/**
 * この組織で同時編集を使うか。
 * @param raw 既定では環境変数。テストからは直接渡す
 */
export function isCollabEnabledForOrg(orgId: string | null | undefined, raw: string = RAW): boolean {
  if (!orgId) return false
  const allowed = parseOrgIds(raw)
  if (allowed.size === 0) return false
  return allowed.has('*') || allowed.has(orgId.trim().toLowerCase())
}
