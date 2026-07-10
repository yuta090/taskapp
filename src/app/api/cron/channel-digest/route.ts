import { NextRequest, NextResponse } from 'next/server'
import {
  findDigestEligibleGroups,
  findGroupTextMessagesSince,
  ingestDigestTasks,
  clearAndRenumberOpenDigestTasks,
  findLineAccountById,
} from '@/lib/channels/store'
import { pushLineMessage } from '@/lib/channels/line/client'
import { callLlm } from '@/lib/ai/client'
import {
  buildDigestExtractionPrompt,
  parseLlmDigestExtraction,
  buildDigestPushText,
  buildDigestFlexMessage,
  buildDigestRetryKey,
} from '@/lib/channels/digest/compute'
import { formatDateToLocalString } from '@/lib/gantt/dateUtils'

/**
 * POST /api/cron/channel-digest
 *
 * pg_cron が毎朝7時(JST) app_invoke_channel_digest() 経由で pg_net から呼び出す内部API。
 * digest対象グループ（active×digest_enabled×accountがactive）ごとに:
 *   1. 抽出水位より後のグループ発言をLLMで抽出し、原子INSERT＋水位更新（exactly-once）
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
  const jstDateStr = formatDateToLocalString(new Date())

  let extractedTasks = 0
  let digestsSent = 0
  const skipped: Array<{ groupId: string; reason: string }> = []
  const errors: string[] = []

  await Promise.allSettled(
    groups.map(async (group) => {
      try {
        const messages = await findGroupTextMessagesSince(
          group.id,
          group.lastExtractedMessageCreatedAt,
        )

        if (messages.length > 0) {
          try {
            const prompt = buildDigestExtractionPrompt(
              messages.map((message, index) => ({ index, body: message.body })),
            )
            const llmResponse = await callLlm({ orgId: group.orgId, messages: prompt, maxTokens: 1500 })
            const extracted = parseLlmDigestExtraction(llmResponse.content)

            if (extracted === null) {
              skipped.push({ groupId: group.id, reason: 'llm_response_unparseable' })
            } else {
              const candidates = extracted
                .filter((task) => messages[task.sourceIndex] !== undefined)
                .map((task) => ({
                  sourceMessageId: messages[task.sourceIndex].id,
                  title: task.title,
                  assigneeHint: task.assigneeHint,
                }))
              const newWatermark = messages[messages.length - 1].createdAt
              extractedTasks += await ingestDigestTasks(group.id, newWatermark, candidates)
            }
          } catch (error) {
            // org_ai_config未設定・LLM API障害等。このグループの抽出だけスキップし、配信(既存open分)は継続する
            const reason = error instanceof Error ? error.message : String(error)
            skipped.push({ groupId: group.id, reason })
          }
        }

        // 配信: 新規抽出の有無によらず、既存のopenタスクも含めて毎朝再採番してから送る
        const numbered = await clearAndRenumberOpenDigestTasks(group.id)
        if (numbered.length === 0) return

        const account = await findLineAccountById(group.accountId)
        if (!account) {
          errors.push(`group ${group.id}: line account not found`)
          return
        }

        const pushText = buildDigestPushText(
          numbered.map((task) => ({ digestNumber: task.digestNumber, title: task.title })),
        )
        const flex = buildDigestFlexMessage(
          numbered.map((task) => ({
            digestNumber: task.digestNumber,
            title: task.title,
            taskId: task.id,
          })),
        )

        await pushLineMessage({
          accessToken: account.accessToken,
          to: group.externalGroupId,
          messages: [{ type: 'text', text: pushText }, flex],
          retryKey: buildDigestRetryKey(group.id, jstDateStr),
        })
        digestsSent += 1
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
