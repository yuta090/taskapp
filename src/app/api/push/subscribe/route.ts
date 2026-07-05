import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * POST /api/push/subscribe
 *
 * Registers (or transfers ownership of) a Web Push subscription for the
 * current session's user. `push_subscriptions.endpoint` is globally UNIQUE
 * and RLS only lets a user update their own rows, so a browser-side upsert
 * fails once another user has ever subscribed from the same browser/device.
 * This route runs with service_role so it can delete a stale row owned by a
 * different user before re-inserting it under the current user — this is
 * how a shared browser correctly moves push ownership from one logged-in
 * user to the next.
 *
 * 認証: セッション必須（getUser()）。
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
    const keys = body.keys as { p256dh?: unknown; auth?: unknown } | undefined
    const p256dh = typeof keys?.p256dh === 'string' ? keys.p256dh : null
    const auth = typeof keys?.auth === 'string' ? keys.auth : null
    const userAgent = typeof body.userAgent === 'string' ? body.userAgent : null

    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json({ error: 'endpoint and keys are required' }, { status: 400 })
    }

    const admin = createAdminClient() as SupabaseClient

    // Ownership transfer: remove any row for this endpoint that belongs to a
    // different user before upserting under the current user's id.
    const { error: deleteError } = await admin
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', endpoint)
      .neq('user_id', user.id)

    if (deleteError) {
      console.error('[push/subscribe] Failed to release existing subscription:', deleteError)
      return NextResponse.json({ error: 'Failed to register subscription' }, { status: 500 })
    }

    const { error: upsertError } = await admin.from('push_subscriptions').upsert(
      {
        user_id: user.id,
        endpoint,
        p256dh,
        auth,
        user_agent: userAgent,
      },
      { onConflict: 'endpoint' }
    )

    if (upsertError) {
      console.error('[push/subscribe] Failed to upsert subscription:', upsertError)
      return NextResponse.json({ error: 'Failed to register subscription' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[push/subscribe] Unexpected error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
