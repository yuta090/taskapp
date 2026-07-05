import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * POST /api/push/unsubscribe
 *
 * Deletes the current session's push subscription row for the given
 * endpoint. Used both from the settings screen (explicit disable) and from
 * the logout cleanup flow (see src/lib/push/cleanupPushOnLogout.ts) so that
 * a stale subscription never survives past a user's session.
 *
 * 認証: セッション必須（getUser()）。削除は自分の行のみ（user_id を明示指定）。
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: Record<string, unknown> = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }

    const endpoint = typeof body.endpoint === 'string' ? body.endpoint : null
    if (!endpoint) {
      return NextResponse.json({ error: 'endpoint is required' }, { status: 400 })
    }

    const admin = createAdminClient() as SupabaseClient

    const { error } = await admin
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', endpoint)
      .eq('user_id', user.id)

    if (error) {
      console.error('[push/unsubscribe] Failed to delete subscription:', error)
      return NextResponse.json({ error: 'Failed to unsubscribe' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[push/unsubscribe] Unexpected error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
