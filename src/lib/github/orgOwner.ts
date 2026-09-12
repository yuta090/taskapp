// GitHub 連携の操作（インストール開始・インストール完了）は、その組織の owner だけに許可する。
// `/api/github/authorize` と `/api/github/callback` の両方で同じ判定を使うため、
// ここに切り出して二重実装を避ける。
import type { SupabaseClient } from '@supabase/supabase-js'

export async function isOrgOwner(supabase: SupabaseClient, orgId: string, userId: string): Promise<boolean> {
  const { data: membership } = await supabase
    .from('org_memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .single()

  return !!membership && membership.role === 'owner'
}
