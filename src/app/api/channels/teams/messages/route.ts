import { NextRequest, NextResponse } from 'next/server'
import { verifyTeamsActivityRequest } from '@/lib/channels/teams/jwtVerify'
import { normalizeTeamsActivity, type TeamsActivity } from '@/lib/channels/teams/activity'
import { getAppToken, sendTeamsReply } from '@/lib/channels/teams/connectorClient'
import { handleTeamsWebhook, type TeamsWebhookDeps } from '@/lib/channels/teams/webhookHandler'
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
 * POST /api/channels/teams/messages — Microsoft Teams（Bot Framework Connector）の単一
 * messaging endpoint（claim bootstrap・PR-1）。
 *
 * このPRのゴールは未 claim グループでの合言葉償還（claim bootstrap）だけ。claimed グループの
 * 通常発言取り込み・「完了N」は PR-2 の役目（二重処理を避けるため webhookHandler が無処理で返す）。
 *
 * 認証: Authorization: Bearer <JWT>（Bot Framework Connector が署名）。
 *   - env(TEAMS_BOT_APP_ID) 未設定はサーバー誤設定 → fail-closed で 500（google-chat webhook と
 *     同じ思想。既知鍵で黙って通さない）。
 *   - トークン無し/検証失敗（★SSRF防御のserviceurl不一致を含む）は 401。
 *
 * 処理順序（重要）: rawBody取得 → JSON parse → verifyTeamsActivityRequest（activity.serviceUrl を
 * 突合するため、JWT検証にはボディの解釈が先に要る）。したがって不正JSONは認証結果を問わず400。
 *
 * Teams（Bot Framework）はGoogle Chatと異なりHTTPレスポンス自体は返信にならない（非同期
 * チャネル）。返信はConnector REST（connectorClient.ts）への明示的なPOSTで行う。
 *
 * Bot Framework の再送ループを避けるため、非message/内容起因の失敗は常に200を返す。
 */
function buildDeps(serviceUrl: string, conversationId: string): TeamsWebhookDeps {
  return {
    loadPlatformAccount: async () => {
      const accId = await findFirstPlatformAccountId('teams')
      if (!accId) return null
      const acc = await findChannelAccountCredentials(accId, 'teams')
      if (!acc || acc.status !== 'active') return null
      return { id: acc.id }
    },
    findActiveGroup: async (accountId, channelId) => {
      const g = await findActiveGroup(accountId, channelId)
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
    externalChatGroupCapacity: (orgId) => orgExternalChatGroupCapacity(orgId, 'teams'),
    createPendingClaim: (input) => findOrCreatePendingGroupClaim(input),
    redeemCodeOnly: (codeHash, accountId, channelId, groupDisplayName, maxActiveGroups) =>
      redeemCodeOnlyClaim(codeHash, accountId, channelId, groupDisplayName, maxActiveGroups),
    generateChallengeLabel: () => generateGroupClaimChallengeLabel(),
    registerInvalidAttempt: (accountId, channelId) =>
      registerInvalidClaimAttemptAndCheckLimit(accountId, channelId),
    reply: async (text) => {
      const appId = process.env.TEAMS_BOT_APP_ID
      const appPassword = process.env.TEAMS_BOT_APP_PASSWORD
      if (!appId || !appPassword) {
        console.error('teams webhook: TEAMS_BOT_APP_ID/TEAMS_BOT_APP_PASSWORD not configured; reply skipped')
        return
      }
      const result = await sendTeamsReply(
        { serviceUrl, conversationId, text },
        { getToken: () => getAppToken(appId, appPassword) },
      )
      if (!result.ok) {
        console.error('teams webhook: reply failed', result.error)
      }
    },
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()

  let activity: TeamsActivity
  try {
    activity = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const verification = await verifyTeamsActivityRequest(
    request.headers.get('authorization'),
    activity.serviceUrl,
  )
  if (!verification.ok) {
    if (verification.reason === 'env_missing') {
      // サーバー誤設定（TEAMS_BOT_APP_ID 未設定）。既知鍵で黙って通さない。
      console.error('teams webhook: TEAMS_BOT_APP_ID not configured')
      return NextResponse.json({ error: 'server not configured' }, { status: 500 })
    }
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const normalized = normalizeTeamsActivity(activity)
  if (!normalized) {
    // conversationUpdate等の非message、またはグループID解決不能。無処理200。
    return NextResponse.json({})
  }

  try {
    await handleTeamsWebhook(
      normalized,
      buildDeps(normalized.serviceUrl ?? '', normalized.conversationId ?? ''),
    )
    return NextResponse.json({})
  } catch (error) {
    console.error('teams webhook: unhandled error', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
