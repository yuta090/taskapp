import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { mfaGuardResponse } from '@/lib/auth/apiMfaGuard'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 外部チャット（ChatGPT 等）との接続の一覧。
 *
 * 見えるのは「自分が許可した接続」。組織のオーナーは、その組織の全員分が見える
 * （誰がどこにつないでいるかを把握し、必要なら解除できるようにするため）。
 */
export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })
  // 二要素認証: 登録済み×コード未入力のまま service role で読み書きさせない
  // （同じ形のルートと揃える。往復は増えない）
  const mfaBlock = await mfaGuardResponse(supabase as unknown as SupabaseClient, user)
  if (mfaBlock) return mfaBlock

  // この人がオーナーの組織（その組織の全接続が見える）
  const { data: membershipRows } = await supabase
    .from('org_memberships')
    .select('org_id, role')
    .eq('user_id', user.id)

  const memberships = (membershipRows || []) as unknown as { org_id: string; role: string }[]
  const ownedOrgIds = memberships.filter((m) => m.role === 'owner').map((m) => m.org_id)

  // api_keys は RLS で読める範囲が限られるうえ、oauth_tokens は service role 専用。
  // 表示に必要な最小限だけを admin で引き、見せる範囲はここで絞る。
  //
  // ⚠ ここから下は「ログイン確認 → 所属の確認 → 接続 → 名前」の直列。並列にしない判断をした：
  // 滅多に開かない設定画面で、クエリを割って重複を取り除く手数に見合わない。2回目以降は
  // 画面側のキャッシュが効く
  const admin = createAdminClient()
  let query = admin
    .from('api_keys')
    .select('id, name, org_id, user_id, allowed_actions, created_at, last_used_at, is_active, oauth_client_id, organizations(name)')
    .eq('issued_via', 'oauth')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    // 上限。ここは滅多に増えないが、際限なく返す形にはしない
    .limit(200)

  query = ownedOrgIds.length > 0
    ? query.or(`user_id.eq.${user.id},org_id.in.(${ownedOrgIds.join(',')})`)
    : query.eq('user_id', user.id)

  const { data, error } = await query
  if (error) {
    console.error('GET /api/oauth/connections error:', error.message)
    return NextResponse.json({ error: '接続を読み込めませんでした' }, { status: 500 })
  }

  const rows = (data || []) as unknown as {
    id: string
    name: string
    org_id: string
    user_id: string
    allowed_actions: string[]
    created_at: string
    last_used_at: string | null
    organizations: { name: string } | null
  }[]

  // 誰の接続かは、他人の分（オーナーとして見えている分）だけ名前を引く
  const otherUserIds = [...new Set(rows.filter((r) => r.user_id !== user.id).map((r) => r.user_id))]
  const names = new Map<string, string>()
  if (otherUserIds.length > 0) {
    const { data: profiles } = await admin.from('profiles').select('id, display_name').in('id', otherUserIds)
    for (const p of (profiles || []) as { id: string; display_name: string | null }[]) {
      names.set(p.id, p.display_name || '（名前未設定）')
    }
  }

  return NextResponse.json({
    connections: rows.map((r) => ({
      id: r.id,
      name: r.name,
      orgName: r.organizations?.name || '（名称未設定）',
      canWrite: r.allowed_actions.includes('write'),
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      isMine: r.user_id === user.id,
      ownerName: r.user_id === user.id ? null : (names.get(r.user_id) ?? '（不明）'),
    })),
  })
}
