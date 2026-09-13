import { createClient } from '@/lib/supabase/server'
import { mfaGuardResponse } from '@/lib/auth/apiMfaGuard'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

import { UUID_REGEX } from '@/lib/uuid'
import { inviteStatus, type InviteStatus } from '@/lib/invites/status'
import { canManageInvite } from '@/lib/invites/canManage'

interface InviteRow {
  id: string
  email: string
  invitee_name: string | null
  role: string
  space_id: string
  created_at: string
  expires_at: string
  accepted_at: string | null
  spaces: { name: string } | null
}

export interface InviteListItem {
  id: string
  email: string
  invitee_name: string | null
  role: string
  space_id: string
  space_name: string
  created_at: string
  expires_at: string
  accepted_at: string | null
  status: InviteStatus
}

/**
 * GET /api/invites/pending?org_id=<uuid>            … 事務所ぜんぶ（オーナーのみ・従来どおり）
 * GET /api/invites/pending?space_id=<uuid>          … そのプロジェクトだけ（プロジェクトの admin/editor）
 *   &status=all を付けると、承諾済み・期限切れも含めた履歴を返す（既定は保留中だけ）
 *
 * 取り消し・再送ができるかは can_manage で画面に伝える（判定は lib/invites/canManage.ts）。
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // 二要素認証: 登録済み × コード未入力(aal1) は service role で触る前に弾く（RLS 経由でない経路の防衛）
    const mfaBlock = await mfaGuardResponse(supabase as SupabaseClient, user)
    if (mfaBlock) return mfaBlock

    const orgId = request.nextUrl.searchParams.get('org_id')
    const spaceId = request.nextUrl.searchParams.get('space_id')
    const wantsAll = request.nextUrl.searchParams.get('status') === 'all'

    if (!orgId && !spaceId) {
      return NextResponse.json({ error: 'Invalid or missing org_id' }, { status: 400 })
    }
    if (orgId && !UUID_REGEX.test(orgId)) {
      return NextResponse.json({ error: 'Invalid or missing org_id' }, { status: 400 })
    }
    if (spaceId && !UUID_REGEX.test(spaceId)) {
      return NextResponse.json({ error: 'Invalid space_id' }, { status: 400 })
    }

    // プロジェクト指定のときは、そのプロジェクトの事務所をサーバー側で引く
    let targetOrgId = orgId
    if (spaceId) {
      const { data: space } = await (supabase as SupabaseClient)
        .from('spaces')
        .select('org_id')
        .eq('id', spaceId)
        .single()
      if (!space?.org_id) {
        return NextResponse.json({ error: 'Space not found' }, { status: 404 })
      }
      targetOrgId = space.org_id as string
    }

    const [{ data: orgMembership }, { data: spaceMembership }] = await Promise.all([
      (supabase as SupabaseClient)
        .from('org_memberships')
        .select('role')
        .eq('user_id', user.id)
        .eq('org_id', targetOrgId!)
        .single(),
      spaceId
        ? (supabase as SupabaseClient)
            .from('space_memberships')
            .select('role')
            .eq('user_id', user.id)
            .eq('space_id', spaceId)
            .single()
        : Promise.resolve({ data: null }),
    ])

    // 取り消し・再送ができるか。プロジェクト指定のときはそのプロジェクトの管理者も含む
    const canManage = canManageInvite(orgMembership?.role, spaceMembership?.role)
    if (spaceId) {
      if (!orgMembership || !['owner', 'member'].includes(orgMembership.role)) {
        return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
      }
      if (!spaceMembership || !['admin', 'editor'].includes(spaceMembership.role)) {
        return NextResponse.json({ error: 'Permission denied for this space' }, { status: 403 })
      }
    } else if (orgMembership?.role !== 'owner') {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    }

    const admin = createAdminClient() as SupabaseClient
    let query = admin
      .from('invites')
      .select('id, email, invitee_name, role, space_id, created_at, expires_at, accepted_at, spaces!invites_space_id_fkey(name)')

    query = spaceId ? query.eq('space_id', spaceId) : query.eq('org_id', targetOrgId!)

    // 返事待ち = まだ承諾していない かつ 期限内
    if (!wantsAll) {
      query = query.is('accepted_at', null).gt('expires_at', new Date().toISOString())
    }

    // 履歴は増え続けるので直近だけ返す
    if (wantsAll) query = query.limit(100)

    query = query.order('created_at', { ascending: false })

    const { data, error } = await query

    if (error) {
      console.error('Failed to fetch pending invites:', error)
      return NextResponse.json({ error: 'Failed to fetch pending invites' }, { status: 500 })
    }

    const now = Date.now()
    const invites: InviteListItem[] = ((data || []) as unknown as InviteRow[]).map((row) => ({
      id: row.id,
      email: row.email,
      invitee_name: row.invitee_name ?? null,
      role: row.role,
      space_id: row.space_id,
      space_name: row.spaces?.name ?? '',
      created_at: row.created_at,
      expires_at: row.expires_at,
      accepted_at: row.accepted_at ?? null,
      status: inviteStatus(row, now),
    }))

    return NextResponse.json({ invites, can_manage: canManage })
  } catch (err) {
    console.error('List pending invites error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
