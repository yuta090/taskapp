import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildPushMessage, type PushNotificationRow, type PushRecipientRole } from '@/lib/push/buildPushMessage'
import {
  PUSH_IMMEDIATE_TYPES,
  pushSkipReason,
  pushSkipReasonWithoutCount,
  QUIET_HOURS_END,
  QUIET_HOURS_EXEMPT_TYPES,
} from '@/lib/notifications/delivery'
import { jstDayStartUtc, jstNow } from '@/lib/datetime/jstNow'
import {
  DEFAULT_NOTIFICATION_EMAIL_PREFS,
  isNotificationTypeMuted,
  type NotificationEmailPrefs,
} from '@/lib/notifications/digest'
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
 * 鳴らすかどうかは src/lib/notifications/delivery.ts が正本:
 *   - 相手を待たせる種類だけ鳴らす（知らせるだけの通知では鳴らさない）
 *   - 夜21時〜朝8時・土日は鳴らさない（「至急」だけ例外）
 *   - 1人1日 PUSH_DAILY_CAP 件まで（超えたぶんは受信箱と翌朝のまとめに残る）
 *   - 本人が設定画面でその種類を切っていたら鳴らさない（メールと同じ設定を共有する）
 * 鳴らさないと決めた通知も受信箱には残るので、消えるわけではない。
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

    // 種類と時間帯だけで弾けるものは、購読も件数も引かずにここで返す
    const nowReal = new Date()
    const jstDate = jstNow(nowReal)
    const earlySkip = pushSkipReasonWithoutCount({ type: notificationRow.type, jstDate })
    if (earlySkip) {
      return NextResponse.json({ sent: 0, failed: 0, removed: 0, skipped: earlySkip })
    }

    // ここから先に要る3つは互いに独立なので同時に投げる。順番に待つと、
    // 「そもそも購読が1件も無い」ことを知る前に残り2つを無駄に往復することになる
    // （購読ゼロが今のところ大多数で、しかも件数の集計が一番重い）。
    //
    // その日すでに何件鳴らしたか＝押し寄せた日に端末が鳴り続けないための歯止め。
    // 「鳴らした記録」は持っていないので、鳴る条件を満たす通知が今日どれだけ届いたかで数える
    // （静かな時間帯のぶんは鳴っていないので、朝8時以降に届いたものだけを対象にする）。
    const needsCount = !QUIET_HOURS_EXEMPT_TYPES.includes(notificationRow.type)
    const windowStart = new Date(jstDayStartUtc(nowReal).getTime() + QUIET_HOURS_END * 60 * 60 * 1000)

    const [subscriptionsResult, prefsResult, countResult] = await Promise.all([
      admin
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth')
        .eq('user_id', notificationRow.to_user_id),
      admin
        .from('notification_email_prefs')
        .select('email_enabled, on_task_assigned, on_task_mentioned, on_review_request, on_client_response, on_meeting_reminder, digest_frequency')
        .eq('user_id', notificationRow.to_user_id)
        .maybeSingle(),
      needsCount
        ? admin
            .from('notifications')
            .select('id', { count: 'exact', head: true })
            .eq('to_user_id', notificationRow.to_user_id)
            .eq('channel', 'in_app')
            .in('type', PUSH_IMMEDIATE_TYPES)
            .gte('created_at', windowStart.toISOString())
            .neq('id', notificationRow.id)
        : Promise.resolve({ count: 0, error: null }),
    ])

    if (subscriptionsResult.error) {
      console.error('[push/dispatch] Failed to fetch push subscriptions:', subscriptionsResult.error)
      return NextResponse.json({ error: 'Failed to fetch push subscriptions' }, { status: 500 })
    }

    const subscriptionRows = (subscriptionsResult.data || []) as PushSubscriptionRow[]
    if (subscriptionRows.length === 0) {
      return NextResponse.json({ sent: 0, failed: 0, removed: 0 })
    }

    // 本人が設定画面でこの種類を切っていたら鳴らさない。設定が無い人は既定（オン）。
    const prefs = (prefsResult.data as NotificationEmailPrefs | null) ?? DEFAULT_NOTIFICATION_EMAIL_PREFS
    if (isNotificationTypeMuted(notificationRow.type, prefs)) {
      return NextResponse.json({ sent: 0, failed: 0, removed: 0, skipped: 'type_off' })
    }

    if (countResult.error) {
      // 数えられなかっただけで黙らせるのは筋が悪い（届かないほうが困る）ので、0件として続行
      console.error('[push/dispatch] Failed to count today\'s pushes:', countResult.error)
    }
    const immediateCountToday = countResult.count ?? 0

    const skip = pushSkipReason({ type: notificationRow.type, jstDate, immediateCountToday })
    if (skip) {
      return NextResponse.json({ sent: 0, failed: 0, removed: 0, skipped: skip })
    }

    // 送ると決まってから引く（送らない場合はそもそも要らない）
    const { data: membership } = await admin
      .from('org_memberships')
      .select('role')
      .eq('org_id', notificationRow.org_id)
      .eq('user_id', notificationRow.to_user_id)
      .maybeSingle()

    const role: PushRecipientRole =
      (membership as { role?: string } | null)?.role === 'client' ? 'client' : 'internal'

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

    // 期限切れの購読の削除と、使えた購読の記録は互いに独立なので同時に
    const [deleteResult, updateResult] = await Promise.all([
      staleIds.length > 0
        ? admin.from('push_subscriptions').delete().in('id', staleIds)
        : Promise.resolve({ error: null }),
      usedIds.length > 0
        ? admin.from('push_subscriptions').update({ last_used_at: new Date().toISOString() }).in('id', usedIds)
        : Promise.resolve({ error: null }),
    ])
    if (deleteResult.error) {
      console.error('[push/dispatch] Failed to remove stale push subscriptions:', deleteResult.error)
    }
    if (updateResult.error) {
      console.error('[push/dispatch] Failed to update last_used_at:', updateResult.error)
    }

    return NextResponse.json({ sent, failed, removed: staleIds.length })
  } catch (error) {
    console.error('[push/dispatch] Unexpected error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
