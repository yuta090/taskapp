import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendNotificationDigestEmail } from '@/lib/email/notificationDigest'
import { buildDigest, type DigestNotification, type NotificationEmailPrefs } from '@/lib/notifications/digest'
import { jstNow } from '@/lib/datetime/jstNow'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * POST /api/cron/notification-digest
 *
 * pg_cron が毎朝1回(JST)呼び出す内部API。方針=即時送信は作らず「1日1回のまとめ」だけ。
 * notification_email_prefs で受信ONのユーザーごとに、前回配信以降(初回は期間ぶん)の
 * in_app 通知を種類別に集約し、1通のダイジェストメールを送る。
 *   - daily: 毎日 / weekly: JST月曜のみ / none・email_enabled=false: 送らない
 *   - 二重送信防止: 送信成功後 last_digest_sent_at を更新し、次回はそれ以降だけ対象にする
 *
 * 認証: Authorization: Bearer ${CRON_SECRET}（他cronと同一パターン）。
 * dryRun=true で送信せず計画のみ返す。recipientOverride で宛先を上書き（動作確認用・記録スキップ）。
 */
export async function POST(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      console.error('[notification-digest] CRON_SECRET is not configured')
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
    const url = new URL(request.url)
    const dryRun = url.searchParams.get('dryRun') === 'true' || body.dryRun === true
    const recipientOverride =
      url.searchParams.get('recipientOverride') ||
      (typeof body.recipientOverride === 'string' ? body.recipientOverride : null)

    const admin = createAdminClient() as SupabaseClient
    // 絶対時刻は本物の現在時刻を使う（window計算・保存用）。jstNow は曜日成分の判定にのみ使う
    // （jstNow の絶対時刻はオフセットしており記録に使ってはいけない）。
    const nowReal = new Date()
    const jstWeekday = jstNow(nowReal).getDay() // 0=日..6=土（JST）

    // 受信ONのユーザーの設定を取得
    const { data: prefsRows, error: prefsError } = await admin
      .from('notification_email_prefs')
      .select('user_id, email_enabled, on_task_assigned, on_task_mentioned, on_review_request, on_client_response, on_meeting_reminder, digest_frequency, last_digest_sent_at')
      .eq('email_enabled', true)
      .neq('digest_frequency', 'none')

    if (prefsError) {
      console.error('[notification-digest] Failed to fetch prefs:', prefsError)
      return NextResponse.json({ error: 'Failed to fetch prefs' }, { status: 500 })
    }

    type PrefsRow = NotificationEmailPrefs & { user_id: string; last_digest_sent_at: string | null }
    // weekly は JST月曜のみ配信。daily は毎日。
    const eligible = ((prefsRows || []) as PrefsRow[]).filter(
      (p) => p.digest_frequency === 'daily' || (p.digest_frequency === 'weekly' && jstWeekday === 1),
    )

    if (eligible.length === 0) {
      return NextResponse.json({ candidateCount: 0, emailsSent: 0, errors: [] })
    }

    const userIds = eligible.map((p) => p.user_id)

    // 最長window(7d)ぶんの in_app 通知をまとめて取得し、ユーザーごとに since で絞る。
    const earliest = new Date(nowReal.getTime() - 7 * 24 * 60 * 60 * 1000)
    const { data: notifRows, error: notifError } = await admin
      .from('notifications')
      .select('to_user_id, type, payload, space_id, created_at')
      .in('to_user_id', userIds)
      .eq('channel', 'in_app')
      // 絶対時刻(instant)の比較なので toISOString は正しい（日付成分の切り出しではない）
      .gte('created_at', earliest.toISOString())

    if (notifError) {
      console.error('[notification-digest] Failed to fetch notifications:', notifError)
      return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 })
    }

    type NotifRow = { to_user_id: string; type: string; payload: Record<string, unknown> | null; space_id: string; created_at: string }
    const notifs = (notifRows || []) as NotifRow[]

    // space 名を解決
    const spaceIds = [...new Set(notifs.map((n) => n.space_id))]
    const spaceNameById = new Map<string, string>()
    if (spaceIds.length > 0) {
      const { data: spaces } = await admin.from('spaces').select('id, name').in('id', spaceIds)
      for (const s of (spaces || []) as Array<{ id: string; name: string }>) {
        spaceNameById.set(s.id, s.name)
      }
    }

    const notifsByUser = new Map<string, NotifRow[]>()
    for (const n of notifs) {
      const list = notifsByUser.get(n.to_user_id) || []
      list.push(n)
      notifsByUser.set(n.to_user_id, list)
    }

    // display_name を解決（メールは auth.users が正）
    const { data: profiles } = await admin.from('profiles').select('id, display_name').in('id', userIds)
    const displayNameById = new Map<string, string | null>(
      ((profiles || []) as Array<{ id: string; display_name: string | null }>).map((p) => [p.id, p.display_name]),
    )

    let emailsSent = 0
    const errors: string[] = []
    const plan: Array<{ userId: string; totalCount: number }> = []
    const sentUserIds: string[] = []

    await Promise.allSettled(
      eligible.map(async (pref) => {
        try {
          const windowMs = pref.digest_frequency === 'weekly' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000
          const since = pref.last_digest_sent_at
            ? new Date(pref.last_digest_sent_at)
            : new Date(nowReal.getTime() - windowMs)

          const userNotifs: DigestNotification[] = (notifsByUser.get(pref.user_id) || [])
            .filter((n) => new Date(n.created_at) >= since)
            .map((n) => ({
              type: n.type,
              payload: n.payload,
              space_name: spaceNameById.get(n.space_id) ?? null,
              created_at: n.created_at,
            }))

          const digest = buildDigest(userNotifs, pref)
          if (!digest) return

          plan.push({ userId: pref.user_id, totalCount: digest.totalCount })
          if (dryRun) return

          const { data: authData } = await admin.auth.admin.getUserById(pref.user_id)
          const email = authData.user?.email
          if (!email) return

          await sendNotificationDigestEmail({
            to: recipientOverride || email,
            displayName: displayNameById.get(pref.user_id) ?? null,
            sections: digest.sections,
            totalCount: digest.totalCount,
          })
          emailsSent += 1
          if (!recipientOverride) sentUserIds.push(pref.user_id)
        } catch (err) {
          console.error(`[notification-digest] Failed for ${pref.user_id}:`, err)
          errors.push(`${pref.user_id}: ${err instanceof Error ? err.message : 'unknown error'}`)
        }
      }),
    )

    // 送信成功したユーザーの last_digest_sent_at を更新（二重送信防止）
    if (sentUserIds.length > 0) {
      const sentAt = nowReal.toISOString()
      const { error: updateError } = await admin
        .from('notification_email_prefs')
        .update({ last_digest_sent_at: sentAt })
        .in('user_id', sentUserIds)
      if (updateError) {
        console.error('[notification-digest] Failed to update last_digest_sent_at:', updateError)
      }
    }

    return NextResponse.json({
      candidateCount: eligible.length,
      emailsSent,
      errors,
      ...(dryRun ? { dryRun: true, plan } : {}),
    })
  } catch (error) {
    console.error('[notification-digest] Unexpected error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
