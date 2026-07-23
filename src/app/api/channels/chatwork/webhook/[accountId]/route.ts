import { NextRequest, NextResponse } from 'next/server'
import {
  handleChatworkWebhook,
  type ChatworkWebhookDeps,
  type ChatworkAccount,
} from '@/lib/channels/chatwork/webhookHandler'
import {
  findChannelAccountCredentials,
  findActiveGroup,
  insertChannelMessage,
  findValidSharedGroupClaimCode,
  findOrCreatePendingGroupClaim,
  redeemCodeOnlyClaim,
  orgExternalChatGroupCapacity,
  markDigestTaskDoneByGroupAndNumberAtomic,
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

export const runtime = 'nodejs'

/**
 * POST /api/channels/chatwork/webhook/[accountId] — Chatwork Webhook v2 受け口
 *
 * account 単位のパスで受け、X-ChatWorkWebhookSignature を account の webhook_token と
 * 照合して認証する（handler内）。署名検証は生ボディに対して行うため text() で受ける。
 *
 * deps の配線は slack/webhook/[accountId]/route.ts と同じ store 関数を使う（claimed/limbo・
 * claim・digest完了の骨格を Slack/Discord と揃えるため）。
 */
const deps: ChatworkWebhookDeps = {
  loadAccount: async (accountId): Promise<ChatworkAccount | null> => {
    const acc = await findChannelAccountCredentials(accountId, 'chatwork')
    if (!acc) return null
    return {
      id: acc.id,
      channel: acc.channel,
      orgId: acc.orgId,
      ownerType: acc.ownerType,
      status: acc.status,
      credentials: acc.credentials,
      // bot_account_id は accounts/route.ts の接続時プローブ（fetchChatworkAccountId）で
      // 解決・保存済み（DDLゼロ・既存credentials JSONのキー）。未設定でも可（fail-safe・
      // self-loop判定はスキップ・自分宛メンション判定は無加工にフォールバック）。
      botAccountId: acc.credentials.bot_account_id || undefined,
    }
  },
  findActiveGroup: async (accountId, roomId) => {
    const g = await findActiveGroup(accountId, roomId)
    return g ? { id: g.id, orgId: g.orgId, spaceId: g.spaceId } : null
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
  redeemCodeOnly: (codeHash, accountId, roomId, groupDisplayName, maxActiveGroups) =>
    redeemCodeOnlyClaim(codeHash, accountId, roomId, groupDisplayName, maxActiveGroups),
  generateChallengeLabel: () => generateGroupClaimChallengeLabel(),
  registerInvalidAttempt: (accountId, roomId) =>
    registerInvalidClaimAttemptAndCheckLimit(accountId, roomId),
  reply: async (apiToken, roomId, text) => {
    const res = await fetch(`https://api.chatwork.com/v2/rooms/${roomId}/messages`, {
      method: 'POST',
      headers: {
        'X-ChatWorkToken': apiToken,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ body: text }).toString(),
    })
    const body = (await res.json().catch(() => null)) as { message_id?: string } | null
    return { messageId: res.ok ? (body?.message_id ?? null) : null }
  },
  completeDigestTask: (groupId, digestNumber, externalUserId) =>
    markDigestTaskDoneByGroupAndNumberAtomic(groupId, digestNumber, externalUserId),
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const { accountId } = await params
    const rawBody = await request.text()
    const signature = request.headers.get('x-chatworkwebhooksignature')
    const result = await handleChatworkWebhook(accountId, rawBody, signature, deps)
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    console.error('Chatwork webhook: unhandled error', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
