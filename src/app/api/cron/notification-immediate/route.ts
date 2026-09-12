import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendNotificationDigestEmail } from '@/lib/email/notificationDigest'
import {
  buildDigest,
  DEFAULT_NOTIFICATION_EMAIL_PREFS,
  isIncludedInEmail,
  type DigestNotification,
  type NotificationEmailPrefs,
} from '@/lib/notifications/digest'
import { EMAIL_IMMEDIATE_TYPES, isQuietHours } from '@/lib/notifications/delivery'
import { jstNow } from '@/lib/datetime/jstNow'
import { mapWithRateLimit } from '@/lib/concurrency/rateLimitedMap'
import { EMAIL_SEND_RATE_LIMIT } from '@/lib/email/sendRateLimit'
import type { SupabaseClient } from '@supabase/supabase-js'

// 対象者が多いと、間隔を空けた送信で既定の実行時間を超えることがある。上限を明示する
export const maxDuration = 300

/**
 * POST /api/cron/notification-immediate
 *
 * pg_cron が5分ごとに呼ぶ内部API。「相手が待って止まっている」通知だけを、
 * 数分ぶんまとめて1通のメールで送る（1件ごとに1通は送らない）。
 *
 *   - 対象の種類は src/lib/notifications/delivery.ts が正本（EMAIL_IMMEDIATE_TYPES）
 *   - 夜21時〜朝8時・土日は送らない。たまったぶんは毎朝のまとめが拾う
 *   - 送ったものには immediate_email_sent_at を立て、毎朝のまとめから外す
 *   - 直近 IMMEDIATE_MAX_AGE_MINUTES 分のものだけを見る。これが無いと、
 *     夜のあいだにたまった通知を朝8時の1回目で全部送ってしまい、
 *     同じ8時に出る「まとめ」と二重になる
 *
 * 認証: Authorization: Bearer ${CRON_SECRET}（他cronと同一パターン）。
 * dryRun=true で送信せず計画のみ返す。recipientOverride で宛先を上書き（動作確認用・記録スキップ）。
 */

/** 何分前までさかのぼるか。cron間隔(5分)より少し広く取り、1回落ちても取りこぼさない */
const IMMEDIATE_MAX_AGE_MINUTES = 15

/** 1回で読む通知の上限（青天井にしない） */
const IMMEDIATE_QUERY_LIMIT = 1000

export async function POST(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      console.error('[notification-immediate] CRON_SECRET is not configured')
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

    const nowReal = new Date()
    // 曜日・時刻の判定だけに jstNow を使う（絶対時刻は nowReal 側が正）
    if (isQuietHours(jstNow(nowReal))) {
      return NextResponse.json({ candidateCount: 0, emailsSent: 0, errors: [], skipped: 'quiet_hours' })
    }

    const admin = createAdminClient() as SupabaseClient
    const cutoff = new Date(nowReal.getTime() - IMMEDIATE_MAX_AGE_MINUTES * 60 * 1000)

    const { data: notifRows, error: notifError } = await admin
      .from('notifications')
      .select('id, to_user_id, type, payload, space_id, created_at')
      .eq('channel', 'in_app')
      .is('immediate_email_sent_at', null)
      .in('type', EMAIL_IMMEDIATE_TYPES)
      // 絶対時刻(instant)の比較なので toISOString は正しい（日付成分の切り出しではない）
      .gte('created_at', cutoff.toISOString())
      .order('created_at', { ascending: true })
      .limit(IMMEDIATE_QUERY_LIMIT)

    if (notifError) {
      console.error('[notification-immediate] Failed to fetch notifications:', notifError)
      return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 })
    }

    type NotifRow = {
      id: string
      to_user_id: string
      type: string
      payload: Record<string, unknown> | null
      space_id: string
      created_at: string
    }
    const notifs = (notifRows || []) as NotifRow[]
    if (notifs.length === 0) {
      return NextResponse.json({ candidateCount: 0, emailsSent: 0, errors: [] })
    }

    const candidateIds = [...new Set(notifs.map((n) => n.to_user_id))]

    // 設定が無い人は既定（オン）。ここで絞り込まないのは digest 側と同じ理由
    const { data: prefsRows, error: prefsError } = await admin
      .from('notification_email_prefs')
      .select('user_id, email_enabled, on_task_assigned, on_task_mentioned, on_review_request, on_client_response, on_meeting_reminder, digest_frequency')
      .in('user_id', candidateIds)

    if (prefsError) {
      console.error('[notification-immediate] Failed to fetch prefs:', prefsError)
      return NextResponse.json({ error: 'Failed to fetch prefs' }, { status: 500 })
    }

    type PrefsRow = NotificationEmailPrefs & { user_id: string }
    const prefsByUser = new Map<string, NotificationEmailPrefs>(
      ((prefsRows || []) as PrefsRow[]).map((p) => [p.user_id, p]),
    )
    const prefsFor = (userId: string): NotificationEmailPrefs =>
      prefsByUser.get(userId) ?? DEFAULT_NOTIFICATION_EMAIL_PREFS

    // space 名を解決
    const spaceIds = [...new Set(notifs.map((n) => n.space_id))]
    const spaceNameById = new Map<string, string>()
    if (spaceIds.length > 0) {
      const { data: spaces } = await admin.from('spaces').select('id, name').in('id', spaceIds)
      for (const s of (spaces || []) as Array<{ id: string; name: string }>) {
        spaceNameById.set(s.id, s.name)
      }
    }

    // display_name を解決（メールは auth.users が正）
    const { data: profiles } = await admin.from('profiles').select('id, display_name').in('id', candidateIds)
    const displayNameById = new Map<string, string | null>(
      ((profiles || []) as Array<{ id: string; display_name: string | null }>).map((p) => [p.id, p.display_name]),
    )

    const notifsByUser = new Map<string, NotifRow[]>()
    for (const n of notifs) {
      const list = notifsByUser.get(n.to_user_id) || []
      list.push(n)
      notifsByUser.set(n.to_user_id, list)
    }

    let emailsSent = 0
    const errors: string[] = []
    const plan: Array<{ userId: string; totalCount: number }> = []

    interface ImmediateOutcome {
      sentNotificationIds: string[]
    }

    await mapWithRateLimit<string, ImmediateOutcome>(
      candidateIds,
      async (userId) => {
        try {
          const prefs = prefsFor(userId)
          const rows = notifsByUser.get(userId) || []
          // 実際にメールへ載る通知だけに印を付けたいので、ここで先に絞る。
          // 載らなかったぶんは印を付けずに残し、毎朝のまとめ側の判断に委ねる。
          const included = rows.filter((n) => isIncludedInEmail(n.type, prefs))
          if (included.length === 0) return { sentNotificationIds: [] }

          const items: DigestNotification[] = included.map((n) => ({
            type: n.type,
            payload: n.payload,
            space_name: spaceNameById.get(n.space_id) ?? null,
            created_at: n.created_at,
          }))

          const digest = buildDigest(items, prefs)
          if (!digest) return { sentNotificationIds: [] }

          plan.push({ userId, totalCount: digest.totalCount })
          if (dryRun) return { sentNotificationIds: [] }

          const { data: authData } = await admin.auth.admin.getUserById(userId)
          const email = authData.user?.email
          if (!email) return { sentNotificationIds: [] }

          await sendNotificationDigestEmail({
            to: recipientOverride || email,
            displayName: displayNameById.get(userId) ?? null,
            sections: digest.sections,
            totalCount: digest.totalCount,
            variant: 'immediate',
          })
          emailsSent += 1
          return { sentNotificationIds: recipientOverride ? [] : included.map((n) => n.id) }
        } catch (err) {
          console.error(`[notification-immediate] Failed for ${userId}:`, err)
          errors.push(`${userId}: ${err instanceof Error ? err.message : 'unknown error'}`)
          return { sentNotificationIds: [] }
        }
      },
      {
        ...EMAIL_SEND_RATE_LIMIT,
        // かたまりの送信が終わるたびに印を付ける。全部終わってからまとめて付けると、
        // 途中で関数が打ち切られたときに「送ったのに印が付かない」通知が残り、
        // 次の実行で同じ内容をもう一度送ってしまう
        onChunkSettled: async (chunkResults) => {
          const sentNotificationIds = chunkResults
            .filter((r): r is PromiseFulfilledResult<ImmediateOutcome> => r.status === 'fulfilled')
            .flatMap((r) => r.value.sentNotificationIds)
          if (sentNotificationIds.length === 0) return

          // 送れたものにだけ印を付ける。「送る予定だった」ではなく「送った」で記録するので、
          // 途中で失敗したぶんは印が付かず、毎朝のまとめが拾ってくれる
          const { error: markError } = await admin
            .from('notifications')
            .update({ immediate_email_sent_at: nowReal.toISOString() })
            .in('id', sentNotificationIds)
          if (markError) {
            console.error('[notification-immediate] Failed to mark notifications as sent:', markError)
          }
        },
      },
    )

    return NextResponse.json({
      candidateCount: candidateIds.length,
      emailsSent,
      errors,
      ...(dryRun ? { dryRun: true, plan } : {}),
    })
  } catch (error) {
    console.error('[notification-immediate] Unexpected error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
