import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendNotificationDigestEmail } from '@/lib/email/notificationDigest'
import {
  buildDigest,
  DEFAULT_NOTIFICATION_EMAIL_PREFS,
  PENDING_INVITES_PREVIEW_LIMIT,
  type DigestNotification,
  type NotificationEmailPrefs,
  type PendingInvitesSummary,
} from '@/lib/notifications/digest'
import { jstNow } from '@/lib/datetime/jstNow'
import { mapWithConcurrency } from '@/lib/admin/concurrency'
import type { SupabaseClient } from '@supabase/supabase-js'

// GoTrue（auth.usersのメール取得）を一斉に呼んでレート制限に当たらないよう絞る
const EMAIL_LOOKUP_CONCURRENCY = 8

/**
 * POST /api/cron/notification-digest
 *
 * pg_cron が毎朝1回(JST)呼び出す内部API。方針=即時送信は作らず「1日1回のまとめ」だけ。
 * notification_email_prefs で受信ONのユーザーごとに、前回配信以降(初回は期間ぶん)の
 * in_app 通知を種類別に集約し、1通のダイジェストメールを送る。
 *   - daily: 毎日 / weekly: JST月曜のみ / none・email_enabled=false: 送らない
 *   - 設定を一度も保存していない人は「オン・毎日」の既定で扱う（設定画面の表示と揃える）
 *   - 二重送信防止: 送信成功後 last_digest_sent_at を更新し、次回はそれ以降だけ対象にする
 *
 * 認証: Authorization: Bearer ${CRON_SECRET}（他cronと同一パターン）。
 * dryRun=true で送信せず計画のみ返す。recipientOverride で宛先を上書き（動作確認用・記録スキップ）。
 */
/**
 * 1回の配信で読む通知の上限。宛先を通知側から引くようになったため、
 * 全ユーザーぶんを読むことになる。青天井にしないための歯止め。
 */
const DIGEST_NOTIFICATION_QUERY_LIMIT = 5000

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

    // 宛先は「設定表から」ではなく「通知が届いた人から」引く。
    // 設定を一度も保存していない人には行が無く、設定表を起点にすると永久に対象外になる
    // （本番で行数0件＝誰にも届いていなかった）。通知が0件の人はどのみち送らないので、
    // 通知側を起点にすれば候補も自然と最小になる。
    const earliest = new Date(nowReal.getTime() - 7 * 24 * 60 * 60 * 1000)
    const { data: notifRows, error: notifError } = await admin
      .from('notifications')
      .select('to_user_id, type, payload, space_id, created_at')
      .eq('channel', 'in_app')
      // 即時メールで既に送ったものは外す（同じ用件が二度届かないように）。
      // 「送る予定だった」ではなく「実際に送った」行だけが除かれるので、
      // 夜間・休日で即時メールを止めたぶんはここで拾える
      .is('immediate_email_sent_at', null)
      // 絶対時刻(instant)の比較なので toISOString は正しい（日付成分の切り出しではない）
      .gte('created_at', earliest.toISOString())
      .order('created_at', { ascending: false })
      .limit(DIGEST_NOTIFICATION_QUERY_LIMIT)

    if (notifError) {
      console.error('[notification-digest] Failed to fetch notifications:', notifError)
      return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 })
    }

    type NotifRow = { to_user_id: string; type: string; payload: Record<string, unknown> | null; space_id: string; created_at: string }
    const notifs = (notifRows || []) as NotifRow[]

    if (notifs.length === DIGEST_NOTIFICATION_QUERY_LIMIT) {
      console.warn(
        `[notification-digest] notifications hit the query limit (${DIGEST_NOTIFICATION_QUERY_LIMIT}); older items may be omitted from this run`,
      )
    }

    const candidateIds = [...new Set(notifs.map((n) => n.to_user_id))]
    if (candidateIds.length === 0) {
      return NextResponse.json({ candidateCount: 0, emailsSent: 0, errors: [] })
    }

    // 候補ぶんの設定を引く。ここで email_enabled 等で絞らないのが肝心で、
    // 「行が無い＝既定オン」と「自分でオフにした」を区別する必要がある。
    const { data: prefsRows, error: prefsError } = await admin
      .from('notification_email_prefs')
      .select('user_id, email_enabled, on_task_assigned, on_task_mentioned, on_review_request, on_client_response, on_meeting_reminder, digest_frequency, last_digest_sent_at')
      .in('user_id', candidateIds)

    if (prefsError) {
      console.error('[notification-digest] Failed to fetch prefs:', prefsError)
      return NextResponse.json({ error: 'Failed to fetch prefs' }, { status: 500 })
    }

    type PrefsRow = NotificationEmailPrefs & { user_id: string; last_digest_sent_at: string | null }
    const prefsByUser = new Map<string, PrefsRow>(
      ((prefsRows || []) as PrefsRow[]).map((p) => [p.user_id, p]),
    )

    // weekly は JST月曜のみ配信。daily は毎日。設定が無ければ既定（オン・毎日）。
    const eligible = candidateIds
      .map<PrefsRow>((userId) => {
        const saved = prefsByUser.get(userId)
        return saved ?? { user_id: userId, last_digest_sent_at: null, ...DEFAULT_NOTIFICATION_EMAIL_PREFS }
      })
      .filter((p) => p.email_enabled)
      .filter((p) => p.digest_frequency === 'daily' || (p.digest_frequency === 'weekly' && jstWeekday === 1))

    if (eligible.length === 0) {
      return NextResponse.json({ candidateCount: 0, emailsSent: 0, errors: [] })
    }

    const userIds = eligible.map((p) => p.user_id)

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

    // 未承諾の招待（作成から3〜21日・未失効）— 対象受信者ぶんをまとめて1クエリ(N+1回避)。
    // この節だけでメールを送ることはない（送るかどうかは通常のdigestの有無で決まる。既存判定は変えない）。
    // 21日を過ぎたら催促しない(いつまでも「未承諾」で出続けるのを避ける)。
    const PENDING_INVITES_QUERY_LIMIT = 200
    const pendingInviteMinAgeCutoff = new Date(nowReal.getTime() - 3 * 24 * 60 * 60 * 1000)
    const pendingInviteMaxAgeCutoff = new Date(nowReal.getTime() - 21 * 24 * 60 * 60 * 1000)
    const { data: pendingInviteRows, error: pendingInviteError } = await admin
      .from('invites')
      .select('created_by, org_id, email, space_id, created_at')
      .in('created_by', userIds)
      .is('accepted_at', null)
      .gt('expires_at', nowReal.toISOString())
      .lte('created_at', pendingInviteMinAgeCutoff.toISOString())
      .gte('created_at', pendingInviteMaxAgeCutoff.toISOString())
      .order('created_at', { ascending: true })
      .limit(PENDING_INVITES_QUERY_LIMIT)

    if (pendingInviteError) {
      console.error('[notification-digest] Failed to fetch pending invites:', pendingInviteError)
    }

    type PendingInviteRow = { created_by: string; org_id: string; email: string; space_id: string; created_at: string }
    let pendingInviteList = (pendingInviteRows || []) as PendingInviteRow[]

    if (pendingInviteList.length === PENDING_INVITES_QUERY_LIMIT) {
      console.warn(
        `[notification-digest] pending invites hit the query limit (${PENDING_INVITES_QUERY_LIMIT}); some may be omitted from this run`,
      )
    }

    if (pendingInviteList.length > 0) {
      // (a) 招待作成者が今もそのorgのメンバーであること・(c) 招待先メールが既存メンバーの
      // メールと重複しないこと、を org_memberships / profiles それぞれ1クエリで確認する
      // (退職者・元メンバーへの露出防止、別経路で参加済みの相手への誤催促防止)。
      const inviteOrgIds = [...new Set(pendingInviteList.map((i) => i.org_id))]
      const { data: membershipRows } = await admin
        .from('org_memberships')
        .select('org_id, user_id')
        .in('org_id', inviteOrgIds)

      type MembershipRow = { org_id: string; user_id: string }
      const memberships = (membershipRows || []) as MembershipRow[]
      const stillMemberSet = new Set(memberships.map((m) => `${m.org_id}:${m.user_id}`))
      const memberUserIds = [...new Set(memberships.map((m) => m.user_id))]

      // profilesにemail列は無い（メールの正はauth.users）。管理用の鍵で1人ずつ引く
      const memberEmailEntries = await mapWithConcurrency(
        memberUserIds,
        EMAIL_LOOKUP_CONCURRENCY,
        async (uid): Promise<[string, string | null]> => {
          const { data, error } = await admin.auth.admin.getUserById(uid)
          if (error) return [uid, null]
          return [uid, data.user?.email?.toLowerCase() ?? null]
        },
      )

      const memberEmailByUserId = new Map<string, string>(
        memberEmailEntries.filter((e): e is [string, string] => !!e[1]),
      )

      const memberEmailsByOrg = new Map<string, Set<string>>()
      for (const m of memberships) {
        const email = memberEmailByUserId.get(m.user_id)
        if (!email) continue
        const set = memberEmailsByOrg.get(m.org_id) ?? new Set<string>()
        set.add(email)
        memberEmailsByOrg.set(m.org_id, set)
      }

      pendingInviteList = pendingInviteList.filter((invite) => {
        if (!stillMemberSet.has(`${invite.org_id}:${invite.created_by}`)) return false
        const orgMemberEmails = memberEmailsByOrg.get(invite.org_id)
        if (orgMemberEmails && orgMemberEmails.has(invite.email.toLowerCase())) return false
        return true
      })
    }

    // 招待先の space 名も解決（notifs 側で解決済みの space と合流）
    const inviteSpaceIds = [...new Set(pendingInviteList.map((i) => i.space_id))].filter(
      (id) => !spaceNameById.has(id),
    )
    if (inviteSpaceIds.length > 0) {
      const { data: inviteSpaces } = await admin.from('spaces').select('id, name').in('id', inviteSpaceIds)
      for (const s of (inviteSpaces || []) as Array<{ id: string; name: string }>) {
        spaceNameById.set(s.id, s.name)
      }
    }

    const pendingInvitesByUser = new Map<string, PendingInvitesSummary>()
    for (const invite of pendingInviteList) {
      const summary = pendingInvitesByUser.get(invite.created_by) ?? { count: 0, items: [] }
      summary.count += 1
      if (summary.items.length < PENDING_INVITES_PREVIEW_LIMIT) {
        summary.items.push({
          email: invite.email,
          spaceName: spaceNameById.get(invite.space_id) ?? null,
        })
      }
      pendingInvitesByUser.set(invite.created_by, summary)
    }

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

          const pendingInvites = pendingInvitesByUser.get(pref.user_id)
          if (pendingInvites) digest.pendingInvites = pendingInvites

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
            pendingInvites: digest.pendingInvites,
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
      // update ではなく upsert。設定を保存したことがない人は行が無く、update だと
      // 記録できずに毎回「前回送信なし」に戻ってしまう（同じ通知を繰り返し送る）。
      const { error: updateError } = await admin
        .from('notification_email_prefs')
        .upsert(
          sentUserIds.map((userId) => ({ user_id: userId, last_digest_sent_at: sentAt })),
          { onConflict: 'user_id' },
        )
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
