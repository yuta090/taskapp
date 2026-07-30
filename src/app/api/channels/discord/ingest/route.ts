import { NextRequest, NextResponse } from 'next/server'
import { verifyIngestSignature } from '@/lib/channels/discord/ingestAuth'
import {
  handleDiscordIngest,
  type DiscordIngestDeps,
  type DiscordIngestEvent,
} from '@/lib/channels/discord/ingestHandler'
import { sendDiscordChannelMessage } from '@/lib/channels/discord/client'
import {
  findFirstPlatformAccountId,
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

export const runtime = 'nodejs'

/**
 * POST /api/channels/discord/ingest — Discord Gateway ワーカーからの内部取り込み口。
 *
 * ⚠ 実質 service role への公開入口。認証は HMAC（timestamp.rawBody を DISCORD_INGEST_HMAC_SECRET で
 * HMAC-SHA256）＋±5分。secret 未設定は fail-closed（500・処理しない）。検証後に取り込み。
 * body は署名検証のため text() で受ける。
 */
const deps: DiscordIngestDeps = {
  loadPlatformAccount: async () => {
    const accId = await findFirstPlatformAccountId('discord')
    if (!accId) return null
    const acc = await findChannelAccountCredentials(accId, 'discord')
    if (!acc || acc.status !== 'active') return null
    const botToken = acc.credentials.bot_token
    if (!botToken) return null
    // bot_external_id は自分宛メンション判定用（DDLゼロ・既存credentials JSONのキー）。未設定でも可（fail-safe）。
    return { id: acc.id, botToken, botExternalId: acc.credentials.bot_external_id || undefined }
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
    await sendDiscordChannelMessage(botToken, channelId, text)
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

export async function POST(request: NextRequest) {
  const rawBody = await request.text()

  const secret = process.env.DISCORD_INGEST_HMAC_SECRET ?? ''
  let verified: boolean
  try {
    verified = verifyIngestSignature(
      rawBody,
      request.headers.get('x-ingest-timestamp'),
      request.headers.get('x-ingest-signature'),
      secret,
      Math.floor(Date.now() / 1000),
    )
  } catch (error) {
    // secret 未設定＝サーバー誤設定。fail-closed で処理しない（既知鍵で黙って通さない）。
    console.error('discord ingest: secret misconfigured', error)
    return NextResponse.json({ error: 'server not configured' }, { status: 500 })
  }
  if (!verified) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let payload: { events?: unknown }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const events: DiscordIngestEvent[] = Array.isArray(payload.events)
    ? (payload.events as DiscordIngestEvent[])
    : []

  try {
    const result = await handleDiscordIngest(events, deps)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('discord ingest: unhandled error', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
