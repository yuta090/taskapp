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
    return { id: acc.id, botToken }
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
  redeemCodeOnly: (codeHash, accountId, channelId, groupDisplayName) =>
    redeemCodeOnlyClaim(codeHash, accountId, channelId, groupDisplayName),
  generateChallengeLabel: () => generateGroupClaimChallengeLabel(),
  registerInvalidAttempt: (accountId, channelId) =>
    registerInvalidClaimAttemptAndCheckLimit(accountId, channelId),
  reply: async (botToken, channelId, text) => {
    await sendDiscordChannelMessage(botToken, channelId, text)
  },
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
