import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendInviteEmail } from '@/lib/email'
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

// UUID v4 format validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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
 * 呼出者はその招待が属するorgのオーナーに限る。
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

    const { data: orgMembership } = await (supabase as SupabaseClient)
      .from('org_memberships')
      .select('role')
      .eq('user_id', user.id)
      .eq('org_id', inviteRow.org_id)
      .single()

    if (!orgMembership || orgMembership.role !== 'owner') {
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
