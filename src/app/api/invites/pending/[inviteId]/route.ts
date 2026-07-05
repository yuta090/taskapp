import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

// UUID v4 format validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * DELETE /api/invites/pending/[inviteId]
 *
 * 保留中の招待を取り消す（行を削除）。呼出者はその招待が属するorgのオーナーに限る。
 */
export async function DELETE(
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
      .select('id, org_id')
      .eq('id', inviteId)
      .single()

    if (lookupError || !invite) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
    }

    const { data: orgMembership } = await (supabase as SupabaseClient)
      .from('org_memberships')
      .select('role')
      .eq('user_id', user.id)
      .eq('org_id', (invite as { org_id: string }).org_id)
      .single()

    if (!orgMembership || orgMembership.role !== 'owner') {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    }

    const { error: deleteError } = await admin
      .from('invites')
      .delete()
      .eq('id', inviteId)

    if (deleteError) {
      console.error('Failed to delete invite:', deleteError)
      return NextResponse.json({ error: 'Failed to cancel invite' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Cancel invite error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
