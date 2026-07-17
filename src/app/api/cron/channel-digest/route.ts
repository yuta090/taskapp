import { NextRequest, NextResponse } from 'next/server'
import {
  findDigestEligibleGroups,
  findGroupTextMessagesSince,
  ingestDigestTasks,
  clearAndRenumberOpenDigestTasks,
  findLineAccountById,
  findIdentityIdsByExternalUserIds,
  reconcileDigestAssignees,
  getOrgChannelPolicyState,
  insertChannelMessage,
  findExistingDigestTaskSourceMessageIds,
} from '@/lib/channels/store'
import { pushLineMessage } from '@/lib/channels/line/client'
import { callLlm } from '@/lib/ai/client'
import {
  buildDigestExtractionPrompt,
  parseLlmDigestExtraction,
  buildDigestPushText,
  buildDigestFlexMessage,
  buildDigestRetryKey,
  resolveAssignee,
} from '@/lib/channels/digest/compute'
import { formatDateToLocalString } from '@/lib/gantt/dateUtils'
import { jstNow } from '@/lib/datetime/jstNow'
import { decideAutoPush, getJstDayOfYear } from '@/lib/channels/metering/decideAutoPush'

/**
 * POST /api/cron/channel-digest
 *
 * pg_cron が毎朝7時(JST) app_invoke_channel_digest() 経由で pg_net から呼び出す内部API。
 * digest対象グループ（active×pickup_mode<>'off'×accountがactive）ごとに:
 *   1. pickup_mode='all'/'all_plus_instant'（フェーズ2・pro以上限定）のみ: 抽出水位より後の
 *      グループ発言をLLMで抽出し、原子INSERT＋水位更新（exactly-once）。all_plus_instant は
 *      さらに、webhookのメンション即時タスク化で既にタスク化済みの発言を候補から除外する
 *      （即時タイトルとLLM抽出タイトルは一致しないため unique制約だけでは二重登録を防げない）。
 *   2. openな申し送りタスクを再採番し、0件でなければLINEへpush
 *
 * 1グループの失敗が他グループを止めない（Promise.allSettled）。
 * org_ai_config未設定orgはそのグループの抽出だけスキップしてログに残す。
 *
 * 認証: Authorization: Bearer ${CRON_SECRET}（client-remindersと同一パターン）。
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[channel-digest] CRON_SECRET is not configured')
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const groups = await findDigestEligibleGroups()
  // JST日付。同日中にcronが再実行されてもretryKeyが同じになりLINE側で二重配信を弾ける
  const jstNowDate = jstNow()
  const jstDateStr = formatDateToLocalString(jstNowDate)

  let extractedTasks = 0
  let digestsSent = 0
  const skipped: Array<{ groupId: string; reason: string }> = []
  const errors: string[] = []

  await Promise.allSettled(
    groups.map(async (group) => {
      try {
        // 抽出は pickup_mode='all'/'all_plus_instant' のみ実行する（mention_only はメンション
        // 即時タスク化で拾うため、夜間LLM抽出との二重登録を避けて経路を分ける。
        // off はfindDigestEligibleGroupsで対象外）
        const extractionEligible = group.pickupMode === 'all' || group.pickupMode === 'all_plus_instant'
        const rawMessages = extractionEligible
          ? await findGroupTextMessagesSince(group.id, group.lastExtractedMessageCreatedAt)
          : []

        // all_plus_instant の重複排除（フェーズ2）: 既にメンション即時タスク化済み
        // （webhookのmention即時パス経由）の発言を抽出候補から除外する。'all' は即時タスクが
        // 存在しないモードのため、このフィルタ自体を呼ばない（no-op・従来と同一挙動を保つ）。
        let messages = rawMessages
        let dedupeFailed = false
        if (group.pickupMode === 'all_plus_instant' && rawMessages.length > 0) {
          try {
            const existingSourceMessageIds = await findExistingDigestTaskSourceMessageIds(
              group.id,
              rawMessages.map((m) => m.id),
            )
            messages = rawMessages.filter((m) => !existingSourceMessageIds.has(m.id))
          } catch (error) {
            // 除外判定が一時障害の場合、誤って二重登録するより抽出を1回遅らせる方が安全。
            // 水位は進めず次回cronで再取得・再判定する
            dedupeFailed = true
            const reason = error instanceof Error ? error.message : String(error)
            skipped.push({ groupId: group.id, reason: `dedupe_failed: ${reason}` })
          }
        }

        if (rawMessages.length > 0 && !dedupeFailed) {
          if (messages.length === 0) {
            // all_plus_instant: 抽出対象の全発言が既に即時タスク化済み。LLMは呼ばず、
            // 水位だけ生取得(rawMessages)の最後まで進める（同じバッチを再取得し続けないため）
            extractedTasks += await ingestDigestTasks(
              group.id,
              rawMessages[rawMessages.length - 1].createdAt,
              [],
            )
          } else {
            try {
              const now = jstNow()
              const prompt = buildDigestExtractionPrompt(
                messages.map((message, index) => ({ index, body: message.body })),
                now,
              )
              const llmResponse = await callLlm({ orgId: group.orgId, messages: prompt, maxTokens: 1500 })
              const extracted = parseLlmDigestExtraction(llmResponse.content, now)

              if (extracted === null) {
                skipped.push({ groupId: group.id, reason: 'llm_response_unparseable' })
              } else {
                const resolved = extracted
                  .filter((task) => messages[task.sourceIndex] !== undefined)
                  .map((task) => ({
                    task,
                    message: messages[task.sourceIndex],
                    // メンション（発話者の明示的な指名）はLLMの推測より確か。上書きさせない
                    assignee: resolveAssignee(messages[task.sourceIndex].mentions, task.assigneeHint),
                  }))

                // メンションで取れたuserIdを既存identityに解決する（未友だちの人は null のまま残る）
                // 必ずこのグループの space で解決する（他顧問先のidentityを引かない）
                const identities = await findIdentityIdsByExternalUserIds(
                  group.orgId,
                  group.spaceId,
                  resolved
                    .map((r) => r.assignee.assigneeExternalUserId)
                    .filter((id): id is string => id !== null),
                )

                const candidates = resolved.map(({ task, message, assignee }) => ({
                  sourceMessageId: message.id,
                  title: task.title,
                  assigneeHint: assignee.assigneeHint,
                  assigneeExternalUserId: assignee.assigneeExternalUserId,
                  assigneeIdentityId: assignee.assigneeExternalUserId
                    ? (identities.get(assignee.assigneeExternalUserId) ?? null)
                    : null,
                  dueDate: task.dueDate,
                  dueTime: task.dueTime,
                }))
                // 水位は生取得(rawMessages)の最後まで進める。all_plus_instantの重複排除で除外が
                // あってもここは変えない（除外された発言だけを毎回再取得し続けないため）
                const newWatermark = rawMessages[rawMessages.length - 1].createdAt
                extractedTasks += await ingestDigestTasks(group.id, newWatermark, candidates)
              }
            } catch (error) {
              // org_ai_config未設定・LLM API障害等。このグループの抽出だけスキップし、配信(既存open分)は継続する
              const reason = error instanceof Error ? error.message : String(error)
              skipped.push({ groupId: group.id, reason })
            }
          }
        }

        // 配信前の自己修復: identity作成と申し送りINSERTがすれ違って担当が未解決のまま
        // 残った分を、同一spaceのidentityへ解決しなおす（取りこぼしを毎朝ならす）。
        // 失敗しても配信自体は続ける（担当が付かないだけで、申し送りは届けたい）
        try {
          await reconcileDigestAssignees(group.id)
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          skipped.push({ groupId: group.id, reason: `reconcile_failed: ${reason}` })
        }

        // 配信: 新規抽出の有無によらず、既存のopenタスクも含めて毎朝再採番してから送る
        const numbered = await clearAndRenumberOpenDigestTasks(group.id)
        if (numbered.length === 0) return

        const account = await findLineAccountById(group.accountId)
        if (!account) {
          errors.push(`group ${group.id}: line account not found`)
          return
        }

        // 送信境界の縮退判定（PR4メータリング・設計正本 §3/§7-10）。digestはauto-push。
        // gate対象外（webhook対話的push・console手動送信）はここを通らない。
        const policy = await getOrgChannelPolicyState(group.orgId)
        const decision = decideAutoPush({
          state: policy.state,
          onExceed: policy.onExceed,
          // getJstDayOfYear は内部で jstNow() を掛けるため、素の now を渡す。
          // jstNowDate（既に jstNow 済み）を渡すと二重変換で UTC 環境だけ1日ずれる。
          jstDayOfYear: getJstDayOfYear(),
        })
        if (!decision.deliver) {
          skipped.push({ groupId: group.id, reason: decision.reason ?? 'quota_suppressed' })
          return
        }

        // 期限順（近い順→期限なし）に採番済み。超過は ⚠️ で示す（Stage 2.6 §5）
        const pushText = buildDigestPushText(
          numbered.map((task) => ({
            digestNumber: task.digestNumber,
            title: task.title,
            dueDate: task.dueDate,
            dueTime: task.dueTime,
            assigneeHint: task.assigneeHint,
          })),
          jstDateStr,
        )
        const flex = buildDigestFlexMessage(
          numbered.map((task) => ({
            digestNumber: task.digestNumber,
            title: task.title,
            taskId: task.id,
          })),
        )

        // outbound記録のexternalMessageIdと同一キーにする（Fix4: 決定的キーでdedupe。
        // 二重起動(pg_net再送・手動再実行)でもchannel_messages_dedupe unique indexにより
        // 二重計上しない＝誤ってsoft/hardへ遷移して正当な配信を抑止する事故を防ぐ）。
        const retryKey = buildDigestRetryKey(group.id, jstDateStr)
        await pushLineMessage({
          accessToken: account.accessToken,
          to: group.externalGroupId,
          messages: [{ type: 'text', text: pushText }, flex],
          retryKey,
        })
        digestsSent += 1

        // push成功後にoutbound記録（billablePush=true）を残す。真実の源=channel_messagesから
        // メータリングを導出するため（設計正本 §3）。
        await insertChannelMessage({
          orgId: group.orgId,
          spaceId: group.spaceId,
          identityId: null,
          accountId: account.id,
          groupId: group.id,
          channel: 'line',
          direction: 'outbound',
          actor: 'secretary',
          externalUserId: null,
          externalMessageId: retryKey,
          contentType: 'text',
          body: pushText,
          payload: {},
          storagePath: null,
          status: 'sent',
          error: null,
          occurredAt: new Date().toISOString(),
          billablePush: true,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`group ${group.id}: ${message}`)
      }
    }),
  )

  return NextResponse.json({
    processedGroups: groups.length,
    extractedTasks,
    digestsSent,
    skipped,
    errors,
  })
}
