import { createClient } from '@/lib/supabase/server'
import { mfaGuardResponse } from '@/lib/auth/apiMfaGuard'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendInviteEmail } from '@/lib/email'
import { resolveSenderOrgName } from '@/lib/email/senderOrgName'
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

import { UUID_REGEX } from '@/lib/uuid'
import { canManageInvite } from '@/lib/invites/canManage'

interface InviteRow {
  id: string
  org_id: string
  space_id: string
  email: string
  role: 'client' | 'member'
  token: string
  accepted_at: string | null
}

/**
 * POST /api/invites/pending/[inviteId]/resend
 *
 * 保留中の招待の有効期限を90日延長し、招待メールを再送する（冪等な再送）。
 * 呼出者は、その招待が属する事務所のオーナー/管理者か、そのプロジェクトの管理者。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ inviteId: string }> }
) {
  try {
    const { inviteId } = await params

    if (!inviteId || !UUID_REGEX.test(inviteId)) {
      return NextResponse.json({ error: 'Invalid invite id' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // 二要素認証: 登録済み × コード未入力(aal1) は service role で触る前に弾く（RLS 経由でない経路の防衛）
    const mfaBlock = await mfaGuardResponse(supabase as SupabaseClient, user)
    if (mfaBlock) return mfaBlock

    const admin = createAdminClient() as SupabaseClient

    const { data: invite, error: lookupError } = await admin
      .from('invites')
      .select('id, org_id, space_id, email, role, token, accepted_at')
      .eq('id', inviteId)
      .single()

    const inviteRow = invite as InviteRow | null

    if (lookupError || !inviteRow) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
    }

    const [{ data: orgMembership }, { data: spaceMembership }] = await Promise.all([
      (supabase as SupabaseClient)
        .from('org_memberships')
        .select('role')
        .eq('user_id', user.id)
        .eq('org_id', inviteRow.org_id)
        .single(),
      (supabase as SupabaseClient)
        .from('space_memberships')
        .select('role')
        .eq('user_id', user.id)
        .eq('space_id', inviteRow.space_id)
        .single(),
    ])

    if (!canManageInvite(orgMembership?.role, spaceMembership?.role)) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    }

    if (inviteRow.accepted_at !== null) {
      return NextResponse.json({ error: '既に承諾済みの招待です' }, { status: 409 })
    }

    const newExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()

    const { error: updateError } = await admin
      .from('invites')
      .update({ expires_at: newExpiresAt })
      .eq('id', inviteId)

    if (updateError) {
      console.error('Failed to extend invite expiry:', updateError)
      return NextResponse.json({ error: 'Failed to resend invite' }, { status: 500 })
    }

    const [orgResult, spaceResult, profileResult] = await Promise.all([
      (supabase as SupabaseClient)
        .from('organizations')
        .select('name')
        .eq('id', inviteRow.org_id)
        .single(),
      (supabase as SupabaseClient)
        .from('spaces')
        .select('name')
        .eq('id', inviteRow.space_id)
        .single(),
      (supabase as SupabaseClient)
        .from('profiles')
        .select('display_name')
        .eq('id', user.id)
        .single(),
    ])

    const orgName = orgResult.data?.name || '組織'
    const spaceName = spaceResult.data?.name || 'プロジェクト'
    const inviterName =
      profileResult.data?.display_name || user.user_metadata?.full_name || user.email || '管理者'

    let emailSent = false
    try {
      await sendInviteEmail({
        to: inviteRow.email,
        inviterName,
        orgName,
        spaceName,
        role: inviteRow.role,
        token: inviteRow.token,
        expiresAt: newExpiresAt,
        // 事務所が保存した招待文面があればそれで送る
        orgId: inviteRow.org_id,
        // 相手が返信したら再送した本人に届くように
        replyTo: user.email,
        senderOrgName: await resolveSenderOrgName(admin, inviteRow.org_id),
      })
      emailSent = true
    } catch (emailError) {
      console.error('Failed to resend invite email:', emailError)
    }

    return NextResponse.json({
      success: true,
      expires_at: newExpiresAt,
      email_sent: emailSent,
    })
  } catch (err) {
    console.error('Resend invite error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
