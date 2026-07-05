import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

// UUID v4 format validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface PendingInviteRow {
  id: string
  email: string
  role: string
  space_id: string
  created_at: string
  expires_at: string
  spaces: { name: string } | null
}

/**
 * GET /api/invites/pending?org_id=<uuid>
 *
 * 保留中（未承諾・未期限切れ）の招待一覧を返す。呼出者はそのorgのオーナーに限る。
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const orgId = request.nextUrl.searchParams.get('org_id')
    if (!orgId || !UUID_REGEX.test(orgId)) {
      return NextResponse.json({ error: 'Invalid or missing org_id' }, { status: 400 })
    }

    const { data: orgMembership } = await (supabase as SupabaseClient)
      .from('org_memberships')
      .select('role')
      .eq('user_id', user.id)
      .eq('org_id', orgId)
      .single()

    if (!orgMembership || orgMembership.role !== 'owner') {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    }

    const admin = createAdminClient() as SupabaseClient
    const { data, error } = await admin
      .from('invites')
      .select('id, email, role, space_id, created_at, expires_at, spaces(name)')
      .eq('org_id', orgId)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Failed to fetch pending invites:', error)
      return NextResponse.json({ error: 'Failed to fetch pending invites' }, { status: 500 })
    }

    const invites = ((data || []) as unknown as PendingInviteRow[]).map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      space_id: row.space_id,
      space_name: row.spaces?.name ?? '',
      created_at: row.created_at,
      expires_at: row.expires_at,
    }))

    return NextResponse.json({ invites })
  } catch (err) {
    console.error('List pending invites error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
