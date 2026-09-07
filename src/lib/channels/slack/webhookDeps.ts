/**
 * Slack Events API 受信（channel_accounts 系統）の deps 配線。
 *
 * account 単位URL（/api/channels/slack/webhook/[accountId]）と組織単位URL
 * （/api/channels/slack/webhook/org/[orgId]）の両方から同じ配線を使うため、route から切り出した。
 * 中身は route にあったものをそのまま移している（挙動不変）。
 */
import type { SlackWebhookDeps, SlackAccount } from '@/lib/channels/slack/webhookHandler'
import {
  findChannelAccountCredentials,
  findActiveGroup,
  insertChannelMessage,
  findValidSharedGroupClaimCode,
  findOrCreatePendingGroupClaim,
  redeemCodeOnlyClaim,
  orgExternalChatGroupCapacity,
  markDigestTaskDoneByGroupAndNumberAtomic,
  createInstantDigestTask,
  assignDigestNumbersToNewTasks,
  updateChannelGroupMetadata,
} from '@/lib/channels/store'
import {
  hashSharedGroupClaimCode,
  generateGroupClaimChallengeLabel,
} from '@/lib/channels/sharedGroupClaim'
import { normalizeClaimCode } from '@/lib/channels/linkCode'
import { registerInvalidClaimAttemptAndCheckLimit } from '@/lib/channels/limboRateLimit'
import { resolveOrgEntitlements } from '@/lib/billing/entitlements'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

export const slackWebhookDeps: SlackWebhookDeps = {
  loadAccount: async (accountId): Promise<SlackAccount | null> => {
    const acc = await findChannelAccountCredentials(accountId, 'slack')
    if (!acc) return null
    return {
      id: acc.id,
      channel: acc.channel,
      orgId: acc.orgId,
      ownerType: acc.ownerType,
      status: acc.status,
      credentials: acc.credentials,
      // bot_user_id は登録時プローブ（auth.test）で解決・保存（DDLゼロ・既存credentials JSONのキー）。
      // 未設定でも可（fail-safe・自分宛メンション判定は無加工にフォールバック）。
      botUserId: acc.credentials.bot_user_id || undefined,
    }
  },
  findActiveGroup: async (accountId, channelId) => {
    const g = await findActiveGroup(accountId, channelId)
    return g
      ? {
          id: g.id,
          orgId: g.orgId,
          spaceId: g.spaceId,
          // 登録直後の練習（対話型チュートリアル）用
          createdAt: g.createdAt ?? null,
          metadata: g.metadata ?? null,
          // 拾い方=off のグループに「次にお届けする一覧に載ります」と嘘をつかないため
          pickupMode: g.pickupMode,
        }
      : null
  },
  insertMessage: (input) => insertChannelMessage(input),
  normalizeClaimCode: (content) => normalizeClaimCode(content),
  hashClaimCode: (canonical) => hashSharedGroupClaimCode(canonical),
  findValidClaimCode: (codeHash, accountId) => findValidSharedGroupClaimCode(codeHash, accountId),
  hasExternalChatChannels: async (orgId) => {
    const admin = createAdminClient() as SupabaseClient
    const ent = await resolveOrgEntitlements(admin, orgId)
    return ent.has('external_chat_channels')
  },
  externalChatGroupCapacity: (orgId) => orgExternalChatGroupCapacity(orgId),
  createPendingClaim: (input) => findOrCreatePendingGroupClaim(input),
  redeemCodeOnly: (codeHash, accountId, channelId, groupDisplayName, maxActiveGroups) =>
    redeemCodeOnlyClaim(codeHash, accountId, channelId, groupDisplayName, maxActiveGroups),
  generateChallengeLabel: () => generateGroupClaimChallengeLabel(),
  registerInvalidAttempt: (accountId, channelId) =>
    registerInvalidClaimAttemptAndCheckLimit(accountId, channelId),
  reply: async (botToken, channelId, text) => {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${botToken}`,
      },
      body: JSON.stringify({ channel: channelId, text }),
    })
    const body = (await res.json().catch(() => null)) as { ok?: boolean; ts?: string } | null
    return { ts: body?.ok === true ? (body.ts ?? null) : null }
  },
  completeDigestTask: (groupId, digestNumber, externalUserId) =>
    markDigestTaskDoneByGroupAndNumberAtomic(groupId, digestNumber, externalUserId),
  createInstantDigestTask: (input) => createInstantDigestTask(input),
  // 練習（対話型チュートリアル）の配線: 番号の確定と、進み具合の保存
  // 番号は「まだ番号が無いタスク」にだけ与える。総入れ替えは配信直前の cron だけの仕事。
  assignDigestNumbersToNewTasks,
  updateGroupMetadata: (groupId, patch) => updateChannelGroupMetadata(groupId, patch),
  insertOutbound: (input) =>
    insertChannelMessage({
      orgId: input.orgId,
      spaceId: input.spaceId,
      identityId: null,
      accountId: input.accountId,
      groupId: input.groupId,
      channel: input.channel,
      direction: input.direction,
      actor: input.actor,
      externalUserId: null,
      externalMessageId: null,
      contentType: 'text',
      body: input.body,
      payload: input.payload,
      storagePath: null,
      status: input.status,
      error: input.error,
      occurredAt: input.occurredAt,
    }),
}
