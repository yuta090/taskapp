import { NextRequest, NextResponse } from 'next/server'
import { verifyChatAppRequest } from '@/lib/channels/google-chat/verify'
import {
  handleGoogleChatWebhook,
  type GoogleChatWebhookDeps,
  type GoogleChatEvent,
} from '@/lib/channels/google-chat/webhookHandler'
import {
  findFirstPlatformAccountId,
  findChannelAccountCredentials,
  findActiveGroup,
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
 * POST /api/channels/google-chat/webhook — Google Chat アプリの HTTP 入口（claim bootstrap・PR-b）。
 *
 * Workspace Events API + Pub/Sub 購読（PR-c）が無い間、Chat アプリは @メンション時の MESSAGE
 * interaction event しか受けない。本 route はその event を受け、未 claim スペースでの合言葉
 * 償還（グループ紐づけ）だけを担う。claimed スペースの通常会話取り込みは PR-c の役目
 * （二重処理を避けるため webhookHandler が無処理で返す）。
 *
 * 認証: Authorization: Bearer <JWT>（Google Chat の chat@system.gserviceaccount.com が署名）。
 *   - env(GOOGLE_CHAT_APP_PROJECT_NUMBER) 未設定はサーバー誤設定 → fail-closed で 500（discord
 *     ingest の secret 未設定と同じ思想。既知鍵で黙って通さない）。
 *   - トークン無し/検証失敗は 401。
 * 検証成功後にのみボディを解釈する。応答はGoogle Chatの同期応答仕様に合わせ、replyText があれば
 * `{ text }` を返す（Chat app は HTTP レスポンス自体がスペースへの発言になる）。
 */
const deps: GoogleChatWebhookDeps = {
  loadPlatformAccount: async () => {
    const accId = await findFirstPlatformAccountId('google_chat')
    if (!accId) return null
    const acc = await findChannelAccountCredentials(accId, 'google_chat')
    if (!acc || acc.status !== 'active') return null
    return { id: acc.id }
  },
  findActiveGroup: async (accountId, spaceName) => {
    const g = await findActiveGroup(accountId, spaceName)
    return g ? { id: g.id, orgId: g.orgId, spaceId: g.spaceId } : null
  },
  normalizeClaimCode: (content) => normalizeClaimCode(content),
  hashClaimCode: (canonical) => hashSharedGroupClaimCode(canonical),
  findValidClaimCode: (codeHash, accountId) => findValidSharedGroupClaimCode(codeHash, accountId),
  hasExternalChatChannels: async (orgId) => {
    const admin = createAdminClient() as SupabaseClient
    const ent = await resolveOrgEntitlements(admin, orgId)
    return ent.has('external_chat_channels')
  },
  externalChatGroupCapacity: (orgId) => orgExternalChatGroupCapacity(orgId, 'google_chat'),
  createPendingClaim: (input) => findOrCreatePendingGroupClaim(input),
  redeemCodeOnly: (codeHash, accountId, spaceName, groupDisplayName, maxActiveGroups) =>
    redeemCodeOnlyClaim(codeHash, accountId, spaceName, groupDisplayName, maxActiveGroups),
  generateChallengeLabel: () => generateGroupClaimChallengeLabel(),
  registerInvalidAttempt: (accountId, spaceName) =>
    registerInvalidClaimAttemptAndCheckLimit(accountId, spaceName),
}

export async function POST(request: NextRequest) {
  const verification = await verifyChatAppRequest(request.headers.get('authorization'))
  if (!verification.ok) {
    if (verification.reason === 'env_missing') {
      // サーバー誤設定（GOOGLE_CHAT_APP_PROJECT_NUMBER 未設定）。既知鍵で黙って通さない。
      console.error('google-chat webhook: GOOGLE_CHAT_APP_PROJECT_NUMBER not configured')
      return NextResponse.json({ error: 'server not configured' }, { status: 500 })
    }
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let event: GoogleChatEvent
  try {
    event = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  try {
    const result = await handleGoogleChatWebhook(event, deps)
    return NextResponse.json(result.replyText ? { text: result.replyText } : {})
  } catch (error) {
    console.error('google-chat webhook: unhandled error', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
