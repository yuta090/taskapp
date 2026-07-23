import { NextRequest, NextResponse } from 'next/server'
import { verifyPushRequest } from '@/lib/channels/google-chat/verifyPush'
import {
  handleGoogleChatIngest,
  type GoogleChatIngestDeps,
  type PubSubPushBody,
} from '@/lib/channels/google-chat/ingestHandler'
import { sendChatMessage } from '@/lib/channels/google-chat/client'
import {
  findFirstPlatformAccountId,
  findActiveGroup,
  insertChannelMessage,
  markDigestTaskDoneByGroupAndNumberAtomic,
  findSubscriptionByResourceName,
  markSubscriptionStatus,
} from '@/lib/channels/store'

export const runtime = 'nodejs'

/**
 * POST /api/channels/google-chat/ingest — Cloud Pub/Sub push 受信口（PR-c）。
 *
 * 購読(PR-d)が張られると、スペースの全メッセージがここへ届く。Google Chat の「拾い」が
 * 初めて成立する経路。認証は OIDC（Pub/Sub push 用 SA が付与する Bearer JWT）。
 *   - env(GOOGLE_CHAT_PUSH_AUDIENCE / GOOGLE_CHAT_PUSH_SA_EMAIL) 未設定はサーバー誤設定 →
 *     fail-closed で 500（既知鍵で黙って通さない）。
 *   - トークン無し/検証失敗は 401。
 * 検証成功後は内容起因の失敗（デコード不能・DBエラー等）を握って常に 200 を返す
 * （Pub/Sub の非2xx再送ループを避けるため）。
 */
const deps: GoogleChatIngestDeps = {
  loadPlatformAccount: async () => {
    const accId = await findFirstPlatformAccountId('google_chat')
    return accId ? { id: accId } : null
  },
  findActiveGroup: async (accountId, spaceName) => {
    const g = await findActiveGroup(accountId, spaceName)
    return g ? { id: g.id, orgId: g.orgId, spaceId: g.spaceId } : null
  },
  insertMessage: (input) => insertChannelMessage(input),
  completeDigestTask: (groupId, digestNumber, externalUserId) =>
    markDigestTaskDoneByGroupAndNumberAtomic(groupId, digestNumber, externalUserId),
  reply: async (spaceName, text) => {
    const result = await sendChatMessage(spaceName, text)
    return { providerMessageId: result.messageName }
  },
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
  findSubscriptionByResourceName: (resourceName) => findSubscriptionByResourceName(resourceName),
  markSubscriptionStatus: (id, status) => markSubscriptionStatus(id, status),
}

export async function POST(request: NextRequest) {
  const verification = await verifyPushRequest(request.headers.get('authorization'))
  if (!verification.ok) {
    if (verification.reason === 'env_missing') {
      // サーバー誤設定（GOOGLE_CHAT_PUSH_AUDIENCE/GOOGLE_CHAT_PUSH_SA_EMAIL 未設定）。
      console.error('google-chat ingest: push verification env not configured')
      return NextResponse.json({ error: 'server not configured' }, { status: 500 })
    }
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // 検証成功後は内容起因の失敗（JSON不正・handler内部の例外）を握って常に200を返す
  // （Pub/Sub は非2xxで再送し続けるため、内容の問題で再送ループを起こさない）。
  try {
    const body = (await request.json()) as PubSubPushBody
    await handleGoogleChatIngest(body, deps)
  } catch (error) {
    console.error('google-chat ingest: unhandled error', error)
  }
  return NextResponse.json({ ok: true })
}
