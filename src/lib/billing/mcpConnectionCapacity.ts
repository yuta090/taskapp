import { createAdminClient } from '@/lib/supabase/admin'
import { resolveOrgLimits } from '@/lib/billing/entitlements'

/**
 * 外部チャット（ChatGPT等）からのリモートMCP接続の数の枠。
 *
 * リモートMCPは **Pro 専有にしない**（2026-09-17 決定）。APIキーと同じ「本人の権限を本人のAIが
 * 使う」経路であり、Pro の売り（自社名義・即時・個別DM・他ツールへの同期）とは別物。
 * ここを閉じると ChatGPT からの試用が消える。差は本数で付ける。
 *
 * 数え方の約束:
 *   - `api_keys` の `issued_via='oauth'` かつ `is_active=true` の行数（org 単位）
 *   - 画面で発行したAPIキー（`issued_via='manual'`）は数えない
 *
 * 執行の原則（プロジェクト枠・相手先グループ枠と同じ）:
 *   **同意が確定する瞬間の1箇所でだけ見る。新規の拒否のみ。**
 *   ツール呼び出しごとや合鍵の付け替え時には見ない。プランが下がっても既存の接続は切らない
 *   （途中で急に使えなくなる方が事故になる。解除は本人か org オーナーの操作で行う）。
 *
 * ※ RLS 越しでは org 全体を数えられないため、件数の集計は admin(service_role) で行う。
 */
export interface McpConnectionCapacity {
  activeCount: number
  /** null = 無制限 */
  maxMcpConnections: number | null
}

export async function orgMcpConnectionCapacity(orgId: string): Promise<McpConnectionCapacity> {
  const admin = createAdminClient()

  // 件数の集計と上限の解決は互いに依存しない。直列に待つと同意の待ち時間が足し算になる
  const [{ count }, limits] = await Promise.all([
    admin
      .from('api_keys')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('issued_via', 'oauth')
      .eq('is_active', true),
    resolveOrgLimits(admin, orgId),
  ])

  return { activeCount: count ?? 0, maxMcpConnections: limits.maxMcpConnections }
}

/** 新しい接続を断るべきか。null上限＝無制限は常に false。 */
export function isMcpConnectionLimitReached(cap: McpConnectionCapacity): boolean {
  if (cap.maxMcpConnections === null) return false
  return cap.activeCount >= cap.maxMcpConnections
}
