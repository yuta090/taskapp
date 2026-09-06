/**
 * リマインドの差出人表示名に載せる事務所名を決める（純関数）。
 * 受信者のタスクがちょうど1つの事務所に収まるときだけ名前を返す。2事務所以上にまたがる／空／不明なら null
 * （別事務所の名前で届く＝テナント混線に見える事故を防ぐ）。
 */
export function senderOrgForDigest(
  taskIds: readonly string[],
  orgIdByTask: ReadonlyMap<string, string | null | undefined>,
  senderNameByOrg: ReadonlyMap<string, string>,
): string | null {
  const orgIds = new Set<string>()
  for (const id of taskIds) {
    const org = orgIdByTask.get(id)
    if (org) orgIds.add(org)
  }
  if (orgIds.size !== 1) return null
  return senderNameByOrg.get([...orgIds][0]) ?? null
}
