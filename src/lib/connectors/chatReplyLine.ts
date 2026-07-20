import type { ChatReplyPayload, ChatReplyResult } from '@/lib/connectors/chatReplySender'
import {
  findChatOriginGroupForTask,
  findGroupById,
  findLineAccountById,
  getOrgChannelPolicyState,
  getPlatformBudgetState,
  insertChannelMessage,
} from '@/lib/channels/store'
import { pushLineMessage } from '@/lib/channels/line/client'
import { toLineRetryKey } from '@/lib/channels/line/retryKey'
import { decideSharedSendBudget } from '@/lib/channels/metering/decideSharedSendBudget'
import { getJstDayOfYear } from '@/lib/channels/metering/decideAutoPush'

/**
 * multica の完了(task.completed)を発生元チャットへ返信する ChatReplySender 実装(契約 §4.1 (b))。
 * notifyChatOnCompletion 経由で **真の 0→1 完了遷移のときだけ** 呼ばれる(再送での二重送信は
 * 上流でゲート済み)。ベストエフォート: 例外/未配信でも TaskApp 側の完了確定は巻き戻さない。
 *
 * 配線(発生元チャット解決 → 資格情報復号 → メータリング → 送信):
 *   1. findChatOriginGroupForTask: 完了タスク → 発生元グループ(channel_digest_tasks.promoted_task_id
 *      逆引き)。無ければ delivered:false(gtasks 直接取り込み・multica 起点など、返信対象なし)。
 *   2. findGroupById → active な channel_group(external_group_id=送信先, account_id)。
 *   3. findLineAccountById: account を復号。**LINE-first**: 復号は LINE 資格情報形状
 *      (channel_secret/access_token)を要求するため、非LINEチャネル/復号不能/disabled は null →
 *      delivered:false。他チャネル(slack/chatwork/…)の送信は adapters 層のメータリング整備後に別PRで追加。
 *   4. メータリング(共有bot送信境界): approval-notify/channel-digest と同一。org層(policy)＋
 *      グローバル層(platform account の実物理上限)の二層。完了返信も共有botの push 通数を消費する
 *      ため、他の自動pushと同じ予算判定を通す(通さないと共有LINE無料枠の持ち出しが非有界になる)。
 *      suppress 時は delivered:false(ベストエフォートなので再送・巻き戻しはしない)。
 *   5. pushLineMessage → 発生元グループへ送信。retryKey=受信イベント event_id で HTTP 二重送信を防ぐ。
 *   6. insertChannelMessage(billablePush:true): 送信通数を課金メータに計上(dedupe は
 *      external_message_id=retryKey の unique index)。
 */

/** 完了返信の本文を組み立てる。summary が無ければ既定文＋成果物URL(あれば)。 */
export function buildCompletionReplyText(summary: string | null, artifactUrl: string | null): string {
  const head = summary && summary.trim() ? summary.trim() : 'AI依頼が完了しました。'
  return artifactUrl ? `${head}\n${artifactUrl}` : head
}

export const lineChatReplySender = async (payload: ChatReplyPayload): Promise<ChatReplyResult> => {
  const { taskRef, summary, artifactUrl, idempotencyKey } = payload

  // 1) 発生元グループの解決。返信対象が無いのは失敗ではない。
  const origin = await findChatOriginGroupForTask(taskRef)
  if (!origin) return { delivered: false }

  // 2) グループ(送信先 external_group_id / account_id)。left/欠損は返信対象なし。
  const group = await findGroupById(origin.groupId)
  if (!group || group.status !== 'active') return { delivered: false }

  // テナンシー防御: digest 行と group の org は同一 group 由来で必ず一致するはず。万一不一致なら
  // 別テナントへ誤送信しないよう送らない(belt-and-suspenders。通常は起きない)。
  if (group.orgId !== origin.orgId) {
    console.error('[connectors] chat-reply org mismatch — refusing to send', {
      taskRef,
      groupOrg: group.orgId,
      originOrg: origin.orgId,
    })
    return { delivered: false }
  }

  // 3) LINE アカウント復号(LINE-first: 非LINE/復号不能/disabled は null)。
  const account = await findLineAccountById(group.accountId)
  if (!account || account.status !== 'active') return { delivered: false }

  // 4) 共有bot送信境界の二層メータリング。専用bot(owner_type='org')はグローバル層 'ok' 固定
  //    (顧客側の枠であり当社の持ち出しではない)。
  const policy = await getOrgChannelPolicyState(group.orgId)
  const globalState = account.ownerType === 'platform' ? await getPlatformBudgetState(account.id) : 'ok'
  const decision = decideSharedSendBudget({
    org: { state: policy.state, onExceed: policy.onExceed },
    global: { state: globalState },
    jstDayOfYear: getJstDayOfYear(),
  })
  if (!decision.deliver) {
    console.log('[connectors] chat-reply suppressed by send budget', { taskRef, reason: decision.reason })
    return { delivered: false }
  }

  // 5) 送信。retryKey は受信イベント event_id(無ければタスク基準の決定的キー)を UUID 形状へ整形する。
  //    LINE の X-Line-Retry-Key は UUID 必須で、multica の event_id(ULID)や素の文字列は 400 になる。
  const retryKey = toLineRetryKey(idempotencyKey ?? `connector-completion:${taskRef}`)
  const text = buildCompletionReplyText(summary, artifactUrl)
  await pushLineMessage({
    accessToken: account.accessToken,
    to: group.externalGroupId,
    messages: [{ type: 'text', text }],
    retryKey,
  })

  // 6) 課金メータへ計上(billablePush:true)。external_message_id=retryKey で二重計上を防ぐ。
  //    ここは push 成功後なので **送信自体は既に完了している**。計上の失敗で delivered を偽にすると
  //    上流が「未送信」と誤認しかねないため、insert 失敗はログのみで握って delivered:true を返す
  //    (グローバル予算の過小計上は日次 reconcile 側の突合で保険する方針)。
  try {
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
      body: text,
      payload: { autoReplyTo: `connector-completion:${taskRef}` },
      storagePath: null,
      status: 'sent',
      error: null,
      occurredAt: new Date().toISOString(),
      billablePush: true,
    })
  } catch (error) {
    console.error('[connectors] chat-reply sent but billable-meter insert failed', { taskRef, error })
  }

  return { delivered: true }
}
