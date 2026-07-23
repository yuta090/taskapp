import { NextRequest, NextResponse } from 'next/server'
import {
  handleTelegramWebhook,
  type TelegramWebhookDeps,
  type TelegramAccount,
} from '@/lib/channels/telegram/webhookHandler'
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
 * POST /api/channels/telegram/webhook/[accountId] — Telegram Bot API webhook 受け口
 *
 * account 単位のパスで受け、X-Telegram-Bot-Api-Secret-Token を account の webhook_secret と
 * 照合して認証する（handler内）。署名検証は生ボディに対して行うため text() で受ける。
 *
 * deps の配線は slack/webhook/[accountId]/route.ts と同じ store 関数を使う（claimed/limbo・claim・
 * digest完了の骨格をSlackと揃えるため。中身は claimLimboCore に共通化済み）。
 */
const deps: TelegramWebhookDeps = {
  loadAccount: async (accountId): Promise<TelegramAccount | null> => {
    const acc = await findChannelAccountCredentials(accountId, 'telegram')
    if (!acc) return null
    return {
      id: acc.id,
      channel: acc.channel,
      orgId: acc.orgId,
      ownerType: acc.ownerType,
      status: acc.status,
      credentials: acc.credentials,
      // bot_username は登録時プローブ（getMe）で解決・保存（DDLゼロ・既存credentials JSONのキー）。
      // 未設定でも可（fail-safe・自分宛メンション判定は無加工にフォールバック）。
      botUsername: acc.credentials.bot_username || undefined,
    }
  },
  findActiveGroup: async (accountId, chatId) => {
    const g = await findActiveGroup(accountId, chatId)
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
  redeemCodeOnly: (codeHash, accountId, chatId, groupDisplayName, maxActiveGroups) =>
    redeemCodeOnlyClaim(codeHash, accountId, chatId, groupDisplayName, maxActiveGroups),
  generateChallengeLabel: () => generateGroupClaimChallengeLabel(),
  registerInvalidAttempt: (accountId, chatId) =>
    registerInvalidClaimAttemptAndCheckLimit(accountId, chatId),
  reply: async (botToken, chatId, text) => {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    })
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; result?: { message_id?: number } }
      | null
    return {
      messageId:
        body?.ok === true && body.result?.message_id != null
          ? String(body.result.message_id)
          : null,
    }
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
    const secretToken = request.headers.get('x-telegram-bot-api-secret-token')
    const result = await handleTelegramWebhook(accountId, rawBody, secretToken, deps)
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    console.error('Telegram webhook: unhandled error', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
