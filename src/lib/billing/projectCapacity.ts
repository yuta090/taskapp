import { createAdminClient } from '@/lib/supabase/admin'
import { resolveOrgLimits } from '@/lib/billing/entitlements'

/**
 * プロジェクト(spaces)数のプラン枠。
 *
 * 課金モデル（2026-07-26 決定・案A）: 値段の階段は Free/Pro/Enterprise の1本のまま、各プランに
 * 「相手先グループ数」と「プロジェクト数」の2枠を置き、**足りない方で tier が上がる**。
 * 秘書用途（事務所）は前者、タスク管理単体用途（開発会社等）は後者で規模に比例する。
 *
 * 数え方の約束:
 *   - `type='project'` のみ（personal スペース＝個人の作業場は課金対象外）
 *   - `archived_at IS NULL` のみ（片付ければ枠が空く＝納得感）
 *   - 上限は `resolveOrgLimits` から解決する（将来の org 別 override の唯一の受け口）
 *
 * 執行の原則（相手先グループ枠と同じ）:
 *   **新規作成のみ拒否・既存プロジェクトは絶対に止めない/隠さない**。上限は作成境界だけで効かせる。
 *
 * ※ RLS 越しだと「自分がメンバーのスペース」しか見えず org 全体を数えられないため、
 *   カウントは admin(service_role) で行う（読むのは件数のみ）。
 */
export interface ProjectCapacity {
  activeCount: number
  /** null = 無制限 */
  maxProjects: number | null
}

export async function orgProjectCapacity(orgId: string): Promise<ProjectCapacity> {
  const admin = createAdminClient()

  // 件数の集計と上限の解決は互いに依存しない。直列に待つと作成の待ち時間が足し算になるので並列で走らせる。
  const [{ count }, limits] = await Promise.all([
    admin
      .from('spaces')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('type', 'project')
      .is('archived_at', null),
    resolveOrgLimits(admin, orgId),
  ])

  return { activeCount: count ?? 0, maxProjects: limits.maxProjects }
}

/** 新規作成を断るべきか。null上限＝無制限は常に false。 */
export function isProjectLimitReached(cap: ProjectCapacity): boolean {
  if (cap.maxProjects === null) return false
  return cap.activeCount >= cap.maxProjects
}
