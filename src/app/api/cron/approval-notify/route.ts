import { NextRequest, NextResponse } from 'next/server'
import {
  claimPendingApprovalNotifications,
  findLineAccountById,
  getOrgChannelPolicyState,
  insertChannelMessage,
  clearApprovalNotifiedAt,
} from '@/lib/channels/store'
import { pushLineMessage } from '@/lib/channels/line/client'
import { buildApprovalPromptFlexMessage, buildDigestRetryKey } from '@/lib/channels/digest/compute'
import { formatDateToLocalString } from '@/lib/gantt/dateUtils'
import { decideAutoPush, getJstDayOfYear } from '@/lib/channels/metering/decideAutoPush'

/**
 * POST /api/cron/approval-notify
 *
 * pending 承認候補（夜間ingestや即時メンションで作られる）を responsible person の 1:1 へ
 * 確認Flexとして送るディスパッチャ。cron(RPC内)からはLINE送信できないため、pg_net → 本APIで送る。
 *
 * 1) claim RPC で未通知の pending を原子的に掴む（approval_notified_at を刻む＝二重送信しない）
 * 2) account 単位で access token を復号し、返った external_user_id へ 1:1 push
 *
 * 1件の失敗が他を止めない（Promise.allSettled）。push 失敗した候補は notified 済みのまま残るが、
 * コンソールの「確認待ち」トレイが確実なフォールバックになる（§4-4 の設計判断）。
 *
 * 認証: Authorization: Bearer ${CRON_SECRET}（他cronと同一パターン）。
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[approval-notify] CRON_SECRET is not configured')
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rows = await claimPendingApprovalNotifications(50)
  const todayJst = formatDateToLocalString(new Date())

  // account の access token は一度だけ復号する（同一OAに複数候補が集まるため）。
  // 解決は *行処理から隔離* する: findLineAccountById は null を返すだけでなく、
  // 暗号鍵未設定・DB障害などで reject し得る。ここで throw を1つでも漏らすと、
  // claim 済み（notified 刻み済み）の全候補が push に到達せず 500 で落ち、まとめて滞留する。
  // よって account 単位で catch し、失敗は null 扱い→当該行だけ errors に落とす。
  const uniqueAccountIds = [...new Set(rows.map((r) => r.channelAccountId))]
  const accounts = new Map<string, Awaited<ReturnType<typeof findLineAccountById>>>()
  await Promise.all(
    uniqueAccountIds.map(async (id) => {
      try {
        accounts.set(id, await findLineAccountById(id))
      } catch (error) {
        console.error(`[approval-notify] account ${id} lookup failed`, error)
        accounts.set(id, null)
      }
    }),
  )

  let sent = 0
  const errors: string[] = []
  const skipped: Array<{ taskId: string; reason: string }> = []
  const jstDayOfYear = getJstDayOfYear()

  await Promise.allSettled(
    rows.map(async (row) => {
      try {
        const account = accounts.get(row.channelAccountId) ?? null
        if (!account) {
          errors.push(`task ${row.taskId}: line account ${row.channelAccountId} not found/decryptable`)
          return
        }

        // 送信境界の縮退判定（PR4メータリング）。承認催促はauto-push。
        const policy = await getOrgChannelPolicyState(row.orgId)
        const decision = decideAutoPush({
          state: policy.state,
          onExceed: policy.onExceed,
          jstDayOfYear,
        })
        if (!decision.deliver) {
          skipped.push({ taskId: row.taskId, reason: decision.reason ?? 'quota_suppressed' })
          // Fix2: claimPendingApprovalNotifications が既に approval_notified_at を刻んでいる。
          // ここで戻さないと notified 済みのまま二度と再claimされず、通知が永久にロストする
          // （隔日縮退・hard抑止のたびに取りこぼす）。未通知へ戻し、次回runで再claim可能にする。
          await clearApprovalNotifiedAt(row.taskId).catch((clearError) =>
            console.error(`[approval-notify] clearApprovalNotifiedAt failed (task ${row.taskId})`, clearError),
          )
          return
        }

        const flex = buildApprovalPromptFlexMessage({
          taskId: row.taskId,
          title: row.title,
          dueDate: row.dueDate,
          dueTime: row.dueTime,
          todayJst,
        })
        // outbound記録のexternalMessageIdと同一キーにする（Fix4: 決定的キーでdedupe。
        // 二重起動でもchannel_messages_dedupe unique indexにより二重計上しない）。
        const retryKey = buildDigestRetryKey(row.taskId, 'approval-notify')
        await pushLineMessage({
          accessToken: account.accessToken,
          to: row.externalUserId,
          messages: [flex],
          // 同一候補への push を HTTP リトライで二重化しない（決定的キー）
          retryKey,
        })
        sent += 1

        // push成功後にoutbound記録（billablePush=true）を残す（設計正本 §3・PR4メータリング）。
        // externalMessageIdはhandleMentionInstantTask（即時1:1送信）と同一キー導出のため、
        // クロス経路（即時×cron）の二重計上も防ぐ（Fix1/Fix4）。
        await insertChannelMessage({
          orgId: row.orgId,
          spaceId: null,
          identityId: null,
          accountId: row.channelAccountId,
          groupId: null,
          channel: 'line',
          direction: 'outbound',
          actor: 'secretary',
          externalUserId: row.externalUserId,
          externalMessageId: retryKey,
          contentType: 'text',
          body: row.title,
          payload: { autoReplyTo: `approval-notify:${row.taskId}` },
          storagePath: null,
          status: 'sent',
          error: null,
          occurredAt: new Date().toISOString(),
          billablePush: true,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`task ${row.taskId}: ${message}`)
      }
    }),
  )

  return NextResponse.json({ claimed: rows.length, sent, errors, skipped })
}
