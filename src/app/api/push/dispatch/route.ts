import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildPushMessage, type PushNotificationRow, type PushRecipientRole } from '@/lib/push/buildPushMessage'
import type { SupabaseClient } from '@supabase/supabase-js'

// web-push is Node-only (uses the `crypto` module directly), so this route
// cannot run on the Edge runtime.
export const runtime = 'nodejs'

interface PushSubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * POST /api/push/dispatch
 *
 * Invoked by the notifications_push_dispatch DB trigger (via pg_net) whenever
 * a row is inserted into `notifications` with channel = 'in_app'. Looks up
 * the recipient's push subscriptions and sends a Web Push notification via
 * web-push. Subscriptions that the browser has revoked (404/410) are removed.
 *
 * 認証: Authorization: Bearer ${CRON_SECRET}（/api/cron/client-reminders と同一パターン）。
 */
export async function POST(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      console.error('[push/dispatch] CRON_SECRET is not configured')
      return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
    }

    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: Record<string, unknown> = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }

    const notificationId = typeof body.notificationId === 'string' ? body.notificationId : null
    if (!notificationId) {
      return NextResponse.json({ error: 'notificationId is required' }, { status: 400 })
    }

    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY
    const vapidSubject = process.env.VAPID_SUBJECT
    if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
      console.error('[push/dispatch] VAPID keys are not configured')
      return NextResponse.json({ error: 'VAPID not configured' }, { status: 500 })
    }

    const admin = createAdminClient() as SupabaseClient

    const { data: notification, error: notificationError } = await admin
      .from('notifications')
      .select('id, org_id, space_id, to_user_id, type, payload')
      .eq('id', notificationId)
      .maybeSingle()

    if (notificationError) {
      console.error('[push/dispatch] Failed to fetch notification:', notificationError)
      return NextResponse.json({ error: 'Failed to fetch notification' }, { status: 500 })
    }
    if (!notification) {
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 })
    }

    const notificationRow = notification as unknown as PushNotificationRow & { to_user_id: string }

    const { data: membership } = await admin
      .from('org_memberships')
      .select('role')
      .eq('org_id', notificationRow.org_id)
      .eq('user_id', notificationRow.to_user_id)
      .maybeSingle()

    const role: PushRecipientRole =
      (membership as { role?: string } | null)?.role === 'client' ? 'client' : 'internal'

    const { data: subscriptions, error: subscriptionsError } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', notificationRow.to_user_id)

    if (subscriptionsError) {
      console.error('[push/dispatch] Failed to fetch push subscriptions:', subscriptionsError)
      return NextResponse.json({ error: 'Failed to fetch push subscriptions' }, { status: 500 })
    }

    const subscriptionRows = (subscriptions || []) as PushSubscriptionRow[]

    if (subscriptionRows.length === 0) {
      return NextResponse.json({ sent: 0, failed: 0, removed: 0 })
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

    const message = buildPushMessage(notificationRow, role)
    const payloadJson = JSON.stringify(message)

    let sent = 0
    let failed = 0
    const staleIds: string[] = []
    const usedIds: string[] = []

    await Promise.allSettled(
      subscriptionRows.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payloadJson
          )
          sent += 1
          usedIds.push(sub.id)
        } catch (err) {
          failed += 1
          const statusCode = (err as { statusCode?: number } | null)?.statusCode
          if (statusCode === 404 || statusCode === 410) {
            staleIds.push(sub.id)
          }
          console.error('[push/dispatch] Failed to send push notification:', err)
        }
      })
    )

    if (staleIds.length > 0) {
      const { error: deleteError } = await admin.from('push_subscriptions').delete().in('id', staleIds)
      if (deleteError) {
        console.error('[push/dispatch] Failed to remove stale push subscriptions:', deleteError)
      }
    }
    if (usedIds.length > 0) {
      const { error: updateError } = await admin
        .from('push_subscriptions')
        .update({ last_used_at: new Date().toISOString() })
        .in('id', usedIds)
      if (updateError) {
        console.error('[push/dispatch] Failed to update last_used_at:', updateError)
      }
    }

    return NextResponse.json({ sent, failed, removed: staleIds.length })
  } catch (error) {
    console.error('[push/dispatch] Unexpected error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
