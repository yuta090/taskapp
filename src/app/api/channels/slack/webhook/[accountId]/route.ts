import { NextRequest, NextResponse } from 'next/server'
import {
  handleSlackWebhook,
  type SlackWebhookDeps,
  type SlackAccount,
} from '@/lib/channels/slack/webhookHandler'
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
 * POST /api/channels/slack/webhook/[accountId] — Slack Events API 受け口（channel_accounts 系統）
 *
 * ⚠ 旧統合 /api/slack/webhook（slack_workspaces）とは別系統。こちらは account 単位パスで受け、
 * その account の signing_secret で v0 署名＋リプレイ窓を検証する（handler内）。
 * 署名検証は生ボディに対して行うため text() で受ける。
 *
 * deps の配線は discord/ingest/route.ts と同じ store 関数を使う（claimed/limbo・claim・digest完了の
 * 骨格を discord と揃えるため）。
 */
const deps: SlackWebhookDeps = {
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
    const result = await handleSlackWebhook(
      accountId,
      rawBody,
      {
        signature: request.headers.get('x-slack-signature'),
        timestamp: request.headers.get('x-slack-request-timestamp'),
        nowSeconds: Math.floor(Date.now() / 1000),
      },
      deps,
    )
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    console.error('Slack webhook (channel_accounts): unhandled error', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
