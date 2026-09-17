import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { mfaGuardResponse } from '@/lib/auth/apiMfaGuard'
import type { SupabaseClient } from '@supabase/supabase-js'
import { revokeConnection } from '@/lib/mcp/oauth/store'

/**
 * 外部チャットとの接続を解除する。
 *
 * 解除できるのは、その接続を作った本人か、その組織のオーナー。
 * 解除すると合鍵が全部止まり、つなぎ先からは何も見えなくなる。
 */
export const runtime = 'nodejs'

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })
  // 二要素認証: 登録済み×コード未入力のまま service role で読み書きさせない
  // （同じ形のルートと揃える。往復は増えない）
  const mfaBlock = await mfaGuardResponse(supabase as unknown as SupabaseClient, user)
  if (mfaBlock) return mfaBlock

  const admin = createAdminClient()
  const { data: row } = await admin
    .from('api_keys')
    .select('id, org_id, user_id, issued_via')
    .eq('id', id)
    .maybeSingle()

  if (!row || row.issued_via !== 'oauth') {
    return NextResponse.json({ error: 'その接続は見つかりません' }, { status: 404 })
  }

  let allowed = row.user_id === user.id
  if (!allowed) {
    const { data: membershipRow } = await supabase
      .from('org_memberships')
      .select('role')
      .eq('user_id', user.id)
      .eq('org_id', row.org_id)
      .maybeSingle()
    allowed = (membershipRow as unknown as { role: string } | null)?.role === 'owner'
  }

  if (!allowed) {
    return NextResponse.json({ error: 'この接続を解除する権限がありません' }, { status: 403 })
  }

  try {
    await revokeConnection(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DELETE /api/oauth/connections/[id] error:', error)
    return NextResponse.json({ error: '解除できませんでした' }, { status: 500 })
  }
}
